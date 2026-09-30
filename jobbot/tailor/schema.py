"""The JSON the LLM must return for a tailored resume (Phases 1-3). Facts like employers and dates are
looked up from the profile by `id`, so the model can reword bullets but never change history."""

from __future__ import annotations

from pydantic import BaseModel, Field


class Bullet(BaseModel):
    text: str
    impact_rank: int = Field(description="1 = most impressive bullet in its entry")


class Diagnostics(BaseModel):
    match_score: int
    missing_keywords: list[str]
    red_flags: list[str]
    strong_sections: list[str]
    weak_sections: list[str]


class EntryRewrite(BaseModel):
    id: str = Field(
        description="id of the experience entry, experience group (sub-project) or project in the profile"
    )
    bullets: list[Bullet]


class SkillRow(BaseModel):
    category: str
    items: list[str]


class Verification(BaseModel):
    ats_parser: str
    hiring_manager: str


class TailoredResume(BaseModel):
    diagnostics: Diagnostics
    headline: str = Field(description="one of profile.allowed_titles, closest to the job title")
    summary: str
    experience: list[EntryRewrite]
    projects: list[EntryRewrite]
    skills: list[SkillRow]
    achievements: list[str] = Field(
        default_factory=list, description="profile achievements reworded to fit line lengths; same facts"
    )
    verification: Verification


# The rounds (jobbot/tailor/rounds.py) wrap the resume: the reasoning or the review comes first, so the
# model writes the resume after it and the resume follows from it.
from jobbot.tailor.rounds import JDAnalysis, Review  # noqa: E402


class BuiltResume(BaseModel):
    analysis: JDAnalysis
    resume: TailoredResume


class ReviewedResume(BaseModel):
    review: Review
    resume: TailoredResume
