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
    id: str = Field(description="id of the experience or project entry in the profile")
    bullets: list[Bullet]


class SkillRow(BaseModel):
    category: str
    items: list[str]


class Verification(BaseModel):
    ats_parser: str
    hiring_manager: str


class TailoredResume(BaseModel):
    diagnostics: Diagnostics
    summary: str
    experience: list[EntryRewrite]
    projects: list[EntryRewrite]
    skills: list[SkillRow]
    verification: Verification
