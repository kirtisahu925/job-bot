"""Tailor one job: LLM content (Phases 1-3) -> code fixes -> render -> compile -> fit one page (Phase 4),
with at most `max_revisions` targeted LLM fix-up calls for problems code cannot fix itself."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

from jobbot.config import read_prompt
from jobbot.llm.ledger import Ledger
from jobbot.models import Job
from jobbot.tailor import lint
from jobbot.tailor.compile import TARGET_FILL, CompileError, FitResult, fit_one_page
from jobbot.tailor.latex import Layout, ladder, render
from jobbot.tailor.schema import TailoredResume

log = logging.getLogger(__name__)


def profile_for_llm(profile: dict) -> dict:
    """Everything except contact details and bookkeeping flags."""
    return {k: v for k, v in profile.items() if k not in ("contact", "example")}


def system_prompt() -> str:
    return read_prompt("framework.md") + "\n\n" + read_prompt("tailor.md")


def first_prompt(job: Job, profile: dict) -> str:
    return json.dumps(
        {
            "profile": profile_for_llm(profile),
            "job": {
                "title": job.title,
                "company": job.company,
                "location": job.location,
                "description": job.description,
            },
        },
        ensure_ascii=False,
        indent=1,
    )


def revision_prompt(job: Job, profile: dict, resume: TailoredResume, problems: list[str]) -> str:
    return json.dumps(
        {
            "task": "Fix ONLY the listed problems and return the full corrected JSON. Keep everything else unchanged.",
            "problems": problems,
            "previous": resume.model_dump(),
            "profile": profile_for_llm(profile),
            "job": {"title": job.title, "company": job.company, "description": job.description},
        },
        ensure_ascii=False,
        indent=1,
    )


@dataclass
class TailorOutcome:
    resume: TailoredResume
    tex: str
    pdf: bytes | None
    status: str  # ok | needs_review
    issues: list[lint.Issue] = field(default_factory=list)
    fixes: list[str] = field(default_factory=list)
    revisions: int = 0
    pages: int | None = None
    fill_ratio: float | None = None
    layout_level: int | None = None

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


def tailor_job(
    job: Job, profile: dict, ledger: Ledger, models: list[str], engine: str | None, max_revisions: int = 1
) -> TailorOutcome:
    system = system_prompt()
    layouts = ladder()
    resume = ledger.call(
        purpose="tailor",
        models=models,
        system=system,
        user=first_prompt(job, profile),
        schema=TailoredResume,
        max_output_tokens=24576,
        job_id=job.id,
    )
    revisions = 0
    fixes: list[str] = []
    while True:
        fixes += lint.sanitize(resume, profile)
        issues = lint.check_content(resume)
        fit: FitResult | None = None
        if engine:
            try:
                fit = fit_one_page(lambda layout, r=resume: render(profile, r, layout), layouts, engine)
            except CompileError as exc:
                issues.append(lint.Issue("compile", "document", str(exc)[:400], llm_fixable=False))
            else:
                issues += _pdf_issues(fit, resume, profile, layouts)
        fixable = [i for i in issues if i.llm_fixable]
        if not fixable or revisions >= max_revisions:
            break
        revisions += 1
        resume = ledger.call(
            purpose="revise",
            models=models,
            system=system,
            user=revision_prompt(job, profile, resume, [i.message for i in fixable]),
            schema=TailoredResume,
            max_output_tokens=24576,
            job_id=job.id,
        )

    # Still spilling onto page 2 after revisions: drop the least impactful bullets (framework allows cutting
    # weak content only after spacing is exhausted).
    drops = 0
    while fit is not None and fit.report.pages > 1 and drops < 4:
        note = lint.drop_weakest_bullet(resume)
        if note is None:
            break
        fixes.append(note)
        drops += 1
        fit = fit_one_page(lambda layout, r=resume: render(profile, r, layout), layouts, engine)
        issues = [i for i in issues if i.code != "pages"] + [
            i for i in _pdf_issues(fit, resume, profile, layouts) if i.code == "pages"
        ]

    tex = fit.tex if fit else render(profile, resume, Layout())
    issues += lint.check_tex(tex)
    blocking = [i for i in issues if i.code in ("pages", "compile", "rule3", "markdown", "emdash", "pipe")]
    soft = [i for i in issues if i.code in ("length", "stub", "underfill", "passive")]
    status = "ok" if not blocking and not soft else "needs_review"
    return TailorOutcome(
        resume=resume,
        tex=tex,
        pdf=fit.pdf if fit else None,
        status=status,
        issues=issues,
        fixes=fixes,
        revisions=revisions,
        pages=fit.report.pages if fit else None,
        fill_ratio=fit.report.fill_ratio if fit else None,
        layout_level=fit.level if fit else None,
    )
