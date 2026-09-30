"""Tailor inside your own LaTeX resume (profile/resume.tex, e.g. your Overleaf project): the model rewrites
only the text of its bullets, skills lines and summary; the fact gate checks each rewrite against your resume
and profile; accepted rewrites are patched into your file, which is compiled and ATS-scored exactly as the
built-in template is. Your layout, sections, roles, dates and links never change.

It runs the same rounds as the built-in template (see rounds.py): build, hiring manager review, VP of hiring
review, then the ATS score, with one fix-up call only if the result still breaks a hard rule."""

from __future__ import annotations

import io
import json
import logging
from dataclasses import dataclass, field

import pdfplumber
from pydantic import BaseModel, Field

from jobbot.ats.score import AtsResult, JDKeywords, improvement_requests
from jobbot.ats.score import compute as ats_compute
from jobbot.config import load_own_resume, read_prompt
from jobbot.llm.base import LLMError
from jobbot.llm.ledger import Ledger
from jobbot.models import Job
from jobbot.tailor import lint
from jobbot.tailor.compile import CompileError, compile_tex
from jobbot.tailor.facts import FactGate, rough_text
from jobbot.tailor.generate import TailorOutcome, ats_block, job_for_llm, pdf_text, profile_for_llm
from jobbot.tailor.rounds import (
    DEFAULT_REVIEWERS,
    JDAnalysis,
    Review,
    ats_report,
    pick,
    review_payload,
    review_system,
    round_record,
)
from jobbot.tailor.schema import Diagnostics, Verification
from jobbot.tailor.texslots import Slot, UnsupportedLayout, apply_patches, extract_slots

log = logging.getLogger(__name__)


class SlotPatch(BaseModel):
    id: str = Field(description="slot id from `slots`, e.g. bullet-3, skill-0, summary-0")
    text: str = Field(description="the slot's full new text: plain, with **bold** where the original bolds")


class OwnResumePatches(BaseModel):
    diagnostics: Diagnostics
    patches: list[SlotPatch] = Field(description="only the slots you change")
    verification: Verification


class OwnBuild(BaseModel):
    analysis: JDAnalysis
    answer: OwnResumePatches


class OwnReview(BaseModel):
    review: Review
    answer: OwnResumePatches


def system_prompt() -> str:
    return read_prompt("framework.md") + "\n\n" + read_prompt("tailor_own.md")


def manifest(slots: list[Slot]) -> list[dict]:
    """What the model may edit. Slots holding LaTeX that cannot round-trip (links, colours) are left out."""
    out = []
    for s in slots:
        plain = s.plain
        if plain is None:
            continue
        item = {"id": s.id, "kind": s.kind, "section": s.section, "text": plain}
        if s.entry:
            item["entry"] = s.entry.replace("*", "")
        if s.parent:
            item["parent"] = s.parent.replace("*", "")
        out.append(item)
    return out


def own_prompt(
    job: Job,
    profile: dict,
    slots: list[Slot],
    jd: JDKeywords | None,
    known_skills: list[str] | None,
    current: dict[str, str] | None = None,
    problems: list[str] | None = None,
    preferences: dict | None = None,
) -> str:
    payload: dict = {
        "slots": manifest(slots),
        "profile": profile_for_llm(profile),
        "job": job_for_llm(job),
        "ats": ats_block(profile, jd, known_skills),
        "preferences": preferences or {},
    }
    if current is not None:
        payload = {
            "task": "Fix ONLY the listed problems. Return the full set of patches you want applied, "
            "including the earlier ones you keep.",
            "problems": problems or [],
            "current_patches": [{"id": k, "text": v} for k, v in current.items()],
            **payload,
        }
    return json.dumps(payload, ensure_ascii=False, indent=1)


def page_count(pdf: bytes) -> int:
    with pdfplumber.open(io.BytesIO(pdf)) as doc:
        return len(doc.pages)


@dataclass
class OwnVersion:
    patches: dict[str, str]
    tex: str
    pdf: bytes | None
    pages: int | None
    issues: list[lint.Issue]
    ats: AtsResult | None
    rejected: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def blocking(self) -> list[lint.Issue]:
        return [i for i in self.issues if i.code in ("compile", "pages")]

    def rank(self) -> tuple:
        return (not self.blocking, self.ats.score if self.ats else 0, -len(self.rejected))


def _header_text(tex: str) -> str:
    """Text above the first section (name, contact line, a title line if the resume has one)."""
    start = tex.find("\\begin{document}")
    end = tex.find("\\section", max(start, 0))
    return rough_text(tex[max(start, 0) : end if end != -1 else len(tex)])


class OwnResume:
    """Your resume source, its slots, and what the original compiles to (the page budget)."""

    def __init__(self, tex: str, assets: dict[str, bytes] | None = None, engine: str | None = None):
        self.tex = tex
        self.assets = assets or {}
        self.slots = extract_slots(tex)
        self.engine = engine
        self.pages: int | None = None
        if engine:
            self.pages = page_count(
                compile_tex(tex, engine, self.assets)
            )  # CompileError: your file itself fails

    def body_text(self, patches: dict[str, str]) -> str:
        """Summary and bullets as plain text, after patches: the part of the resume that shows skills in use."""
        parts = []
        for s in self.slots:
            if s.kind in ("bullet", "summary"):
                parts.append(patches.get(s.id) or s.plain or rough_text(s.latex))
        return "\n".join(p.replace("*", "") for p in parts)


def load_own(engine: str | None, errors: list[str] | None = None) -> OwnResume | None:
    """profile/resume.tex ready to tailor, or None (no file, or it cannot be used: the built-in template runs)."""
    loaded = load_own_resume()
    if loaded is None:
        return None
    try:
        return OwnResume(*loaded, engine=engine)
    except (UnsupportedLayout, CompileError) as exc:
        msg = f"profile/resume.tex not used, built-in template instead: {exc}"[:400]
        log.warning(msg)
        if errors is not None:
            errors.append(msg)
        return None


def _gate(
    gate: FactGate, proposed: list[SlotPatch], slots: dict[str, Slot]
) -> tuple[dict[str, str], list[str]]:
    accepted: dict[str, str] = {}
    rejected: list[str] = []
    for p in proposed:
        if p.id not in slots:
            rejected.append(f"{p.id}: no such slot")
            continue
        reasons = gate.check(p.id, p.text)
        if reasons:
            rejected += reasons
        elif p.text.strip() != (slots[p.id].plain or ""):
            accepted[p.id] = p.text.strip()
    return accepted, rejected


def _evaluate(
    own: OwnResume,
    patches: dict[str, str],
    rejected: list[str],
    job: Job,
    profile: dict,
    jd: JDKeywords | None,
    known_skills: list[str] | None,
    target: int,
) -> OwnVersion:
    """Patch, compile, keep the original page count (reverting the rewrites that grew most), then ATS-score."""
    notes: list[str] = []
    patches = dict(patches)
    issues: list[lint.Issue] = []
    tex = apply_patches(own.tex, own.slots, patches)
    pdf: bytes | None = None
    pages: int | None = None
    if own.engine:
        try:
            pdf = compile_tex(tex, own.engine, own.assets)
            pages = page_count(pdf)
            by_id = {s.id: s for s in own.slots}
            growth = sorted(patches, key=lambda i: len(patches[i]) - len(by_id[i].plain or ""), reverse=True)
            while own.pages and pages > own.pages and growth:
                slot_id = growth.pop(0)
                patches.pop(slot_id)
                notes.append(f"{slot_id}: kept your original text so the resume stays on {own.pages} page(s)")
                tex = apply_patches(own.tex, own.slots, patches)
                pdf = compile_tex(tex, own.engine, own.assets)
                pages = page_count(pdf)
            if own.pages and pages > own.pages:
                issues.append(
                    lint.Issue("pages", "document", f"runs to {pages} pages; your resume is {own.pages}")
                )
        except CompileError as exc:
            issues.append(lint.Issue("compile", "document", str(exc)[:400], llm_fixable=False))
            pdf = None
    ats = None
    if jd is not None:
        full = pdf_text(pdf) if pdf else rough_text(tex)
        email = (profile.get("contact") or {}).get("email", "")
        checks = {
            "same page count as your resume": bool(pdf) and (not own.pages or pages == own.pages),
            "standard headings": all(
                h.lower() in full.lower() for h in ("Experience", "Education", "Skills")
            ),
            "contact readable": bool(email) and email in full,
            "clean text extraction": "(cid:" not in full,
        }
        ats = ats_compute(
            resume_text=full,
            body_text=own.body_text(patches),
            headline=_header_text(tex),
            jd=jd,
            job_title=job.title,
            jd_min_years=job.min_years,
            profile=profile,
            known_skills=known_skills,
            format_checks=checks,
            target=target,
        )
    return OwnVersion(patches, tex, pdf, pages, issues, ats, rejected, notes)


def _problems(version: OwnVersion, job: Job, target: int) -> list[str]:
    problems = list(version.rejected)
    if any(i.code == "pages" for i in version.issues) or version.notes:
        problems.append("the resume must stay on its original page count: shorten the longest rewrites")
    if version.ats and version.ats.score < target:
        problems += [a for a in improvement_requests(version.ats, job.title, "") if "headline" not in a]
    return problems


def tailor_own_resume(
    job: Job,
    profile: dict,
    own: OwnResume,
    ledger: Ledger,
    models: list[str],
    *,
    jd: JDKeywords | None = None,
    target: int = 90,
    minimum: int = 80,
    known_skills: list[str] | None = None,
    preferences: dict | None = None,
    reviewers: tuple[str, ...] | list[str] = DEFAULT_REVIEWERS,
    fix_rounds: int = 1,
) -> TailorOutcome:
    base = system_prompt()
    by_id = {s.id: s for s in own.slots}
    gate = FactGate(own.tex, own.slots, profile, known_skills, (jd.required + jd.preferred) if jd else ())
    versions: list[tuple[OwnVersion, OwnResumePatches]] = []
    rounds: list[dict] = []

    def evaluate(answer: OwnResumePatches) -> OwnVersion:
        accepted, rejected = _gate(gate, answer.patches, by_id)
        version = _evaluate(own, accepted, rejected, job, profile, jd, known_skills, target)
        versions.append((version, answer))
        return version

    built = ledger.call(
        purpose="tailor",
        models=models,
        system=base,
        user=own_prompt(job, profile, own.slots, jd, known_skills, preferences=preferences),
        schema=OwnBuild,
        max_output_tokens=16384,
        job_id=job.id,
    )
    version = evaluate(built.answer)
    rounds.append(round_record("build", version.ats, analysis=built.analysis))

    calls = 0
    for reviewer in reviewers:
        problems = _problems(version, job, target)
        try:
            reviewed = ledger.call(
                purpose="review",
                models=models,
                system=review_system(base, reviewer),
                user=review_payload(
                    reviewer,
                    job=job_for_llm(job),
                    profile=profile_for_llm(profile),
                    current={
                        "slots": manifest(own.slots),
                        "current_patches": [{"id": k, "text": v} for k, v in version.patches.items()],
                    },
                    problems=problems,
                    ats=ats_report(version.ats, minimum),
                    ats_keywords=ats_block(profile, jd, known_skills),
                    preferences=preferences or {},
                    rounds=rounds,
                ),
                schema=OwnReview,
                max_output_tokens=16384,
                job_id=job.id,
            )
        except LLMError as exc:  # quota or a bad answer: keep what the earlier rounds built
            rounds.append(round_record(reviewer, None, problems=problems, skipped=str(exc)[:200]))
            break
        calls += 1
        version = evaluate(reviewed.answer)
        rounds.append(round_record(reviewer, version.ats, review=reviewed.review, problems=problems))

    for _ in range(fix_rounds):
        if not (version.blocking or (version.ats and version.ats.score < minimum)):
            break
        problems = _problems(version, job, target)
        try:
            answer = ledger.call(
                purpose="revise",
                models=models,
                system=base,
                user=own_prompt(
                    job, profile, own.slots, jd, known_skills, version.patches, problems, preferences
                ),
                schema=OwnResumePatches,
                max_output_tokens=16384,
                job_id=job.id,
            )
        except LLMError as exc:
            rounds.append(round_record("fix", None, problems=problems, skipped=str(exc)[:200]))
            break
        calls += 1
        version = evaluate(answer)
        rounds.append(round_record("fix", version.ats, problems=problems))

    best, best_answer = pick(
        versions,
        lambda v: bool(v[0].blocking),
        lambda v: v[0].ats.score if v[0].ats else None,
        lambda v: v[0].rank(),
        minimum,
    )
    kept = next(i for i, (v, _) in enumerate(versions) if v is best)
    [r for r in rounds if not r["skipped"]][kept]["kept"] = True
    record = best_answer.model_copy(
        update={"patches": [SlotPatch(id=k, text=v) for k, v in best.patches.items()]}
    )
    return TailorOutcome(
        resume=record,  # type: ignore[arg-type]
        tex=best.tex,
        pdf=best.pdf,
        status="ok" if not best.blocking else "needs_review",
        issues=best.issues,
        fixes=[f"rewrote {len(best.patches)} of {len(manifest(own.slots))} editable lines in your resume"]
        + [f"kept your original text: {r}" for r in best.rejected]
        + best.notes
        + [f"{r['title']} skipped: {r['skipped']}" for r in rounds if r["skipped"]],
        revisions=calls,
        pages=best.pages,
        ats=best.ats,
        ats_rounds=[v.ats.score for v, _ in versions if v.ats],
        rounds=rounds,
    )
