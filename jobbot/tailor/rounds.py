"""The rounds every tailored resume goes through, whichever template it uses:

1. Build: read the job description, your skills and your preferences, reason about the fit, pick the
   keywords, then write the resume (one call, with the analysis written before the resume).
2. Hiring manager review: the manager for this role critiques the draft and fixes what they found.
3. VP of hiring review: a senior hiring manager / VP of Engineering critiques it again and rebuilds it.
4. ATS score, measured in code on the compiled PDF. One more fix-up call runs only when the final resume
   breaks a hard rule (page, compile, unsupported claim) or scores under the ATS minimum.

Each round's resume is compiled, checked and scored, so the dashboard can show what each round changed.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from typing import Literal, TypeVar

from pydantic import BaseModel, Field

from jobbot.ats.score import AtsResult
from jobbot.config import read_prompt

DEFAULT_REVIEWERS = ("hiring_manager", "vp_hiring")

REVIEWERS: dict[str, tuple[str, str]] = {
    # name -> (title shown on the dashboard, persona prompt)
    "hiring_manager": ("Hiring manager review", "review_hiring_manager.md"),
    "vp_hiring": ("VP of hiring review", "review_vp.md"),
}


class JDAnalysis(BaseModel):
    """Round 1's reasoning, written before the resume so the resume follows from it."""

    role_focus: str = Field(description="one sentence: what this team needs the hire to do")
    must_haves: list[str] = Field(description="the JD's hard requirements, in its own words")
    nice_to_haves: list[str]
    seniority: str = Field(description="the level the JD is hiring for and how the candidate compares")
    candidate_fit: list[str] = Field(
        description="'requirement: the profile unit or skill that proves it' for each must-have the profile meets"
    )
    keywords: list[str] = Field(
        description="JD keywords this resume will use, with the job's spelling; only ones the profile supports"
    )
    gaps: list[str] = Field(description="must-haves the profile cannot back up; they stay out of the resume")
    preferences_applied: list[str] = Field(description="how the candidate's preferences shaped the resume")
    strategy: str = Field(description="2-3 sentences: how the resume positions the candidate for this job")


class Finding(BaseModel):
    area: str = Field(description="where: 'summary', 'headline', 'skills', a unit id, or 'unit id bullet N'")
    issue: str
    fix: str = Field(description="what you changed (or, if it cannot be fixed honestly, why not)")
    severity: Literal["high", "medium", "low"]


class Review(BaseModel):
    first_impression: str = Field(description="what you took away from a 6-second scan of the draft")
    verdict: Literal["reject", "maybe", "interview", "strong_interview"] = Field(
        description="your call on the draft as you received it"
    )
    findings: list[Finding] = Field(description="3-8 findings, most important first")
    after: str = Field(description="one sentence: how the rebuilt resume reads now")


def review_system(base: str, reviewer: str) -> str:
    title, persona = REVIEWERS[reviewer]
    return "\n\n".join([base, read_prompt("review.md"), f"# Round: {title}", read_prompt(persona)])


def ats_report(ats: AtsResult | None, minimum: int) -> dict:
    if ats is None:
        return {}
    return {
        "score": ats.score,
        "target": ats.target,
        "minimum": minimum,
        "max_achievable": ats.max_achievable,
        "matched_required": ats.matched_required,
        "matched_preferred": ats.matched_preferred,
        "missing_but_supported": ats.missing_fixable,
        "only_in_skills_list": ats.skills_only,
        "real_gaps_never_claim": ats.missing_gaps,
    }


def earlier(rounds: Sequence[dict]) -> list[dict]:
    """What a reviewer needs from the rounds before: the build strategy and earlier findings, briefly."""
    out = []
    for r in rounds:
        item: dict = {"round": r["title"], "ats_score": r.get("ats_score")}
        if r.get("analysis"):
            item["strategy"] = r["analysis"].get("strategy")
        if r.get("review"):
            item["findings"] = [f"{f['area']}: {f['issue']}" for f in r["review"].get("findings", [])]
        out.append(item)
    return out


def review_payload(
    reviewer: str,
    *,
    job: dict,
    profile: dict,
    current: dict,
    problems: list[str],
    ats: dict,
    ats_keywords: dict,
    preferences: dict,
    rounds: Sequence[dict],
) -> str:
    title, _ = REVIEWERS[reviewer]
    return json.dumps(
        {
            "task": f"{title}: review `current` as described, then return the review and the full rebuilt resume.",
            "current": current,
            "problems": problems,
            "ats_report": ats,
            "earlier_rounds": earlier(rounds),
            "preferences": preferences,
            "job": job,
            "profile": profile,
            "ats": ats_keywords,
        },
        ensure_ascii=False,
        indent=1,
    )


V = TypeVar("V")


def pick(
    versions: Sequence[V],
    blocking: Callable[[V], bool],
    score: Callable[[V], int | None],
    rank: Callable[[V], tuple],
    minimum: int,
) -> V:
    """The latest round that breaks no hard rule and clears the ATS minimum: each review builds on the one
    before, so it wins. If no round clears the bar, the best-ranked version (honest first, then ATS)."""
    good = [v for v in versions if not blocking(v) and (score(v) is None or score(v) >= minimum)]  # type: ignore[operator]
    return good[-1] if good else max(versions, key=rank)


def round_record(
    name: str,
    ats: AtsResult | None,
    *,
    analysis: BaseModel | None = None,
    review: BaseModel | None = None,
    problems: list[str] | None = None,
    skipped: str | None = None,
) -> dict:
    title = {"build": "Build", "fix": "Fix-up"}.get(name) or REVIEWERS[name][0]
    return {
        "name": name,
        "title": title,
        "ats_score": ats.score if ats else None,
        "analysis": analysis.model_dump() if analysis else None,
        "review": review.model_dump() if review else None,
        "problems": problems or [],
        "skipped": skipped,
        "kept": False,
    }
