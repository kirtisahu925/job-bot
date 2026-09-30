"""Tailor one job with the built-in template, in rounds (see rounds.py): build, hiring manager review,
VP of hiring review, then the ATS score. Every round's draft gets code fixes -> render -> compile -> fit
one page (Phase 4) -> lint -> ATS score, and one fix-up call runs only if the final draft breaks a hard rule."""

from __future__ import annotations

import io
import json
import logging
from dataclasses import dataclass, field

import pdfplumber

from jobbot.ats.score import AtsResult, JDKeywords, improvement_requests, profile_supports
from jobbot.ats.score import compute as ats_compute
from jobbot.ats.skills import canonical, in_text, normalize_text
from jobbot.config import read_prompt
from jobbot.llm.base import LLMError
from jobbot.llm.ledger import Ledger
from jobbot.models import Job
from jobbot.profile import experience_units
from jobbot.tailor import lint
from jobbot.tailor.compile import TARGET_FILL, CompileError, FitResult, fit_one_page
from jobbot.tailor.latex import Layout, achievements_of, ladder, render
from jobbot.tailor.rounds import (
    DEFAULT_REVIEWERS,
    ats_report,
    pick,
    review_payload,
    review_system,
    round_record,
)
from jobbot.tailor.schema import BuiltResume, ReviewedResume, TailoredResume

log = logging.getLogger(__name__)


def profile_for_llm(profile: dict) -> dict:
    """Everything except contact details and bookkeeping flags."""
    return {k: v for k, v in profile.items() if k not in ("contact", "example")}


def system_prompt() -> str:
    return read_prompt("framework.md") + "\n\n" + read_prompt("tailor.md")


def ats_block(profile: dict, jd: JDKeywords | None, known_skills: list[str] | None) -> dict:
    if jd is None:
        return {}
    supported = profile_supports(profile, known_skills)
    ptext = normalize_text(json.dumps(profile_for_llm(profile), ensure_ascii=False))
    ok = [s for s in jd.required + jd.preferred if canonical(s) in supported or in_text(s, ptext)]
    return {
        "required": jd.required,
        "preferred": jd.preferred,
        "supported_by_profile": ok,
        "not_in_profile": [s for s in jd.required + jd.preferred if s not in ok],
        "known_skills_without_project_evidence": known_skills or [],
    }


def job_for_llm(job: Job) -> dict:
    return {
        "title": job.title,
        "company": job.company,
        "location": job.location,
        "description": job.description,
    }


def first_prompt(
    job: Job,
    profile: dict,
    jd: JDKeywords | None = None,
    known_skills: list[str] | None = None,
    preferences: dict | None = None,
) -> str:
    return json.dumps(
        {
            "profile": profile_for_llm(profile),
            "job": job_for_llm(job),
            "ats": ats_block(profile, jd, known_skills),
            "preferences": preferences or {},
        },
        ensure_ascii=False,
        indent=1,
    )


def revision_prompt(
    job: Job,
    profile: dict,
    resume: TailoredResume,
    problems: list[str],
    jd: JDKeywords | None = None,
    known_skills: list[str] | None = None,
) -> str:
    return json.dumps(
        {
            "task": "Fix ONLY the listed problems and return the full corrected JSON. Keep everything else unchanged.",
            "problems": problems,
            "previous": resume.model_dump(),
            "profile": profile_for_llm(profile),
            "job": {"title": job.title, "company": job.company, "description": job.description},
            "ats": ats_block(profile, jd, known_skills),
        },
        ensure_ascii=False,
        indent=1,
    )


def plain_text(profile: dict, resume: TailoredResume) -> tuple[str, str]:
    """(everything on the page, summary + bullets only) as plain text, for ATS scoring without a PDF."""
    c = profile.get("contact") or {}
    body = [resume.summary]
    units = {u.id: u for u in experience_units(profile)}
    for rw in resume.experience:
        unit = units.get(rw.id)
        if unit:
            body += [unit.entry.get("role", ""), unit.title or ""]
        body += [b.text for b in rw.bullets]
    for rw in resume.projects:
        body += [b.text for b in rw.bullets]
    skills = [f"{row.category}: {', '.join(row.items)}" for row in resume.skills]
    edu = [f"{e.get('degree', '')} {e.get('institution', '')}" for e in profile.get("education") or []]
    head = [c.get("name", ""), resume.headline, c.get("email", ""), c.get("phone", "")]
    headings = ["Summary", "Experience", "Projects", "Technical Skills", "Education"]
    full = "\n".join([*head, *headings, *body, *skills, *edu, *achievements_of(resume, profile)])
    return full, "\n".join(body)


def pdf_text(pdf: bytes) -> str:
    with pdfplumber.open(io.BytesIO(pdf)) as doc:
        return "\n".join(page.extract_text() or "" for page in doc.pages)


@dataclass
class Version:
    resume: TailoredResume
    fit: FitResult | None
    issues: list[lint.Issue]
    ats: AtsResult | None
    notes: list[str]
    draft: TailoredResume | None = None  # what the model returned (before cuts), for the next round to edit
    overflowed: bool = False  # the model's own draft ran past one page

    @property
    def blocking(self) -> list[lint.Issue]:
        return [i for i in self.issues if i.code in BLOCKING]

    @property
    def soft(self) -> list[lint.Issue]:
        return [i for i in self.issues if i.code in SOFT]

    def rank(self) -> tuple:
        return (not self.blocking, self.ats.score if self.ats else 0, -len(self.soft))


BLOCKING = ("pages", "compile", "rule3", "markdown", "emdash", "pipe", "unsupported")
SOFT = ("length", "stub", "underfill", "passive")


@dataclass
class TailorOutcome:
    resume: TailoredResume  # or own_resume.OwnResumePatches when tailoring inside your own LaTeX file
    tex: str
    pdf: bytes | None
    status: str  # ok | needs_review
    issues: list[lint.Issue] = field(default_factory=list)
    fixes: list[str] = field(default_factory=list)
    revisions: int = 0
    pages: int | None = None
    fill_ratio: float | None = None
    layout_level: int | None = None
    ats: AtsResult | None = None
    ats_rounds: list[int] = field(default_factory=list)
    rounds: list[dict] = field(default_factory=list)  # build, reviews, fix-up: analysis, findings, ATS each

    def record(self) -> dict:
        return {
            "status": self.status,
            "diagnostics": self.resume.diagnostics.model_dump(),
            "verification": self.resume.verification.model_dump(),
            "content": self.resume.model_dump(),
            "lint_issues": [i.__dict__ for i in self.issues],
            "fixes": self.fixes,
            "revisions": self.revisions,
            "pages": self.pages,
            "fill_ratio": self.fill_ratio,
            "layout_level": self.layout_level,
            "ats_score": self.ats.score if self.ats else None,
            "ats": (self.ats.model_dump() | {"rounds": self.ats_rounds}) if self.ats else None,
            "rounds": self.rounds,
        }


def _pdf_issues(
    fit: FitResult, resume: TailoredResume, profile: dict, layouts: list[Layout]
) -> list[lint.Issue]:
    issues: list[lint.Issue] = []
    rep = fit.report
    if rep.pages > 1:
        issues.append(
            lint.Issue(
                "pages",
                "document",
                "content does not fit on one page even at the tightest spacing; "
                "shorten the weakest bullets or drop the least relevant project",
            )
        )
    elif fit.level == len(layouts) - 1 and rep.fill_ratio < TARGET_FILL:
        issues.append(
            lint.Issue(
                "underfill",
                "document",
                f"page is only {rep.fill_ratio:.0%} full at the loosest "
                "spacing; expand a relevant project with one more bullet or add a skills row "
                "using only facts from the profile",
            )
        )
    for label, fill in rep.stubs(lint.bullet_locations(resume, profile)):
        issues.append(
            lint.Issue(
                "stub",
                label,
                f"{label} ends in a short last line ({fill:.0%} full); lengthen "
                "or tighten it so the last line is at least 70% full",
            )
        )
    if rep.summary_fill is not None and rep.summary_fill < 0.70:
        issues.append(
            lint.Issue("stub", "summary", f"summary ends in a short last line ({rep.summary_fill:.0%} full)")
        )
    return issues


def _evaluate(
    resume: TailoredResume,
    job: Job,
    profile: dict,
    engine: str | None,
    layouts: list[Layout],
    jd: JDKeywords | None,
    known_skills: list[str] | None,
    target: int,
) -> tuple[Version, bool]:
    """Compile, cut to one page if needed (on a copy), lint and ATS-score. Returns the version and whether
    the model's own draft overflowed the page (so the next revision can be told to tighten)."""
    candidate = resume.model_copy(deep=True)
    notes: list[str] = []
    fit: FitResult | None = None
    compile_error: lint.Issue | None = None
    overflowed = False
    if engine:
        try:
            fit = fit_one_page(lambda layout, r=candidate: render(profile, r, layout), layouts, engine)
            overflowed = fit.report.pages > 1
            drops = 0
            while fit.report.pages > 1 and drops < 8:
                note = lint.drop_weakest_bullet(candidate)
                if note is None:
                    break
                notes.append(note)
                drops += 1
                fit = fit_one_page(lambda layout, r=candidate: render(profile, r, layout), layouts, engine)
        except CompileError as exc:
            compile_error = lint.Issue("compile", "document", str(exc)[:400], llm_fixable=False)
            fit = None
    issues = lint.check_content(candidate)
    if compile_error:
        issues.append(compile_error)
    if fit:
        issues += _pdf_issues(fit, candidate, profile, layouts)
    tex = fit.tex if fit else render(profile, candidate, Layout())
    issues += lint.check_tex(tex)

    ats = None
    if jd is not None:
        full, body = plain_text(profile, candidate)
        # honesty guard: the resume must not claim a job keyword the profile cannot back up
        unsupported = [
            k
            for k in ats_block(profile, jd, known_skills)["not_in_profile"]
            if in_text(k, normalize_text(body))
        ]
        if unsupported:
            issues.append(
                lint.Issue(
                    "unsupported",
                    "document",
                    f"remove claims your profile does not support: {', '.join(unsupported)}",
                )
            )
        checks = {}
        if fit:
            full = pdf_text(fit.pdf)
            email = (profile.get("contact") or {}).get("email", "")
            checks = {
                "one page": fit.report.pages == 1,
                "standard headings": all(h in full for h in ("Experience", "Education", "Skills")),
                "contact readable": bool(email) and email in full,
                "clean text extraction": "(cid:" not in full,
            }
        checks["no blocking issues"] = not [i for i in issues if i.code in BLOCKING]
        ats = ats_compute(
            resume_text=full,
            body_text=body,
            headline=candidate.headline,
            jd=jd,
            job_title=job.title,
            jd_min_years=job.min_years,
            profile=profile,
            known_skills=known_skills,
            format_checks=checks,
            target=target,
        )
    return Version(candidate, fit, issues, ats, notes), overflowed


def problems_of(version: Version, job: Job, target: int) -> list[str]:
    """What code found wrong with a draft, as instructions for the next round."""
    problems = [i.message for i in version.issues if i.llm_fixable and i.code != "pages"]
    if version.overflowed:
        problems.append(
            "content does not fit on one page; drop the least relevant units or bullets for this job"
        )
    if version.ats and version.ats.score < target:
        problems += improvement_requests(version.ats, job.title, version.resume.headline)
    return problems


def needs_fix(version: Version, minimum: int) -> bool:
    return bool(version.blocking) or bool(version.ats and version.ats.score < minimum)


def tailor_job(
    job: Job,
    profile: dict,
    ledger: Ledger,
    models: list[str],
    engine: str | None,
    *,
    jd: JDKeywords | None = None,
    target: int = 90,
    minimum: int = 80,
    known_skills: list[str] | None = None,
    preferences: dict | None = None,
    reviewers: tuple[str, ...] | list[str] = DEFAULT_REVIEWERS,
    fix_rounds: int = 1,
) -> TailorOutcome:
    """Build, then each reviewer critiques and rebuilds, then one fix-up call if the result still breaks a hard
    rule or scores under `minimum`. The latest good round wins; gaps are never added."""
    base = system_prompt()
    layouts = ladder()
    fixes: list[str] = []
    versions: list[Version] = []
    rounds: list[dict] = []

    def evaluate(resume: TailoredResume) -> Version:
        fixes.extend(lint.sanitize(resume, profile, known_skills))
        version, overflowed = _evaluate(resume, job, profile, engine, layouts, jd, known_skills, target)
        version.draft, version.overflowed = resume, overflowed
        versions.append(version)
        return version

    built = ledger.call(
        purpose="tailor",
        models=models,
        system=base,
        user=first_prompt(job, profile, jd, known_skills, preferences),
        schema=BuiltResume,
        max_output_tokens=24576,
        job_id=job.id,
    )
    version = evaluate(built.resume)
    rounds.append(round_record("build", version.ats, analysis=built.analysis))

    calls = 0
    for reviewer in reviewers:
        problems = problems_of(version, job, target)
        try:
            reviewed = ledger.call(
                purpose="review",
                models=models,
                system=review_system(base, reviewer),
                user=review_payload(
                    reviewer,
                    job=job_for_llm(job),
                    profile=profile_for_llm(profile),
                    current=version.draft.model_dump(),
                    problems=problems,
                    ats=ats_report(version.ats, minimum),
                    ats_keywords=ats_block(profile, jd, known_skills),
                    preferences=preferences or {},
                    rounds=rounds,
                ),
                schema=ReviewedResume,
                max_output_tokens=24576,
                job_id=job.id,
            )
        except LLMError as exc:  # quota or a bad answer: keep what the earlier rounds built
            rounds.append(round_record(reviewer, None, problems=problems, skipped=str(exc)[:200]))
            break
        calls += 1
        version = evaluate(reviewed.resume)
        rounds.append(round_record(reviewer, version.ats, review=reviewed.review, problems=problems))

    for _ in range(fix_rounds):
        if not needs_fix(version, minimum):
            break
        problems = problems_of(version, job, target)
        try:
            resume = ledger.call(
                purpose="revise",
                models=models,
                system=base,
                user=revision_prompt(job, profile, version.draft, problems, jd, known_skills),
                schema=TailoredResume,
                max_output_tokens=24576,
                job_id=job.id,
            )
        except LLMError as exc:
            rounds.append(round_record("fix", None, problems=problems, skipped=str(exc)[:200]))
            break
        calls += 1
        version = evaluate(resume)
        rounds.append(round_record("fix", version.ats, problems=problems))

    best = pick(
        versions, lambda v: bool(v.blocking), lambda v: v.ats.score if v.ats else None, Version.rank, minimum
    )
    evaluated = [r for r in rounds if not r["skipped"]]
    evaluated[next(i for i, v in enumerate(versions) if v is best)]["kept"] = True
    fixes += [f"{r['title']} skipped: {r['skipped']}" for r in rounds if r["skipped"]]
    status = "ok" if not best.blocking and not best.soft else "needs_review"
    tex = best.fit.tex if best.fit else render(profile, best.resume, Layout())
    return TailorOutcome(
        resume=best.resume,
        tex=tex,
        pdf=best.fit.pdf if best.fit else None,
        status=status,
        issues=best.issues,
        fixes=fixes + best.notes,
        revisions=calls,
        pages=best.fit.report.pages if best.fit else None,
        fill_ratio=best.fit.report.fill_ratio if best.fit else None,
        layout_level=best.fit.level if best.fit else None,
        ats=best.ats,
        ats_rounds=[v.ats.score for v in versions if v.ats],
        rounds=rounds,
    )
