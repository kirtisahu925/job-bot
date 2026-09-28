"""Batch job scoring with a cheap model: several JDs per request to stay inside free-tier request caps."""

from __future__ import annotations

import json
import re

from pydantic import BaseModel, Field

from jobbot.config import SearchConfig, read_prompt
from jobbot.llm.base import LLMError
from jobbot.llm.ledger import Ledger
from jobbot.models import Job

SCORING_JD_CHARS = 2500
_BOILERPLATE = re.compile(
    r"^\s*(benefits|perks|what we offer|why join us|equal (employment )?opportunity|eeo|about (the )?company|"
    r"about us|our (commitment|values))\b",
    re.I,
)


class JobScore(BaseModel):
    job_id: str
    score: int
    track: str
    reason: str
    missing_keywords: list[str]
    required_skills: list[str] = Field(default_factory=list)
    preferred_skills: list[str] = Field(default_factory=list)
    degree_required: bool = False

    def jd_keywords(self) -> dict:
        from jobbot.ats.score import JDKeywords

        jd = JDKeywords(
            required=self.required_skills,
            preferred=self.preferred_skills,
            degree_required=self.degree_required,
            source="score",
        )
        return jd.canonicalized().model_dump()


class ScoreBatch(BaseModel):
    results: list[JobScore]


def strip_boilerplate(text: str) -> str:
    """Drop benefits/EEO/about-us tails. Used for scoring only; tailoring always sees the full JD."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if i > 3 and _BOILERPLATE.match(line):
            return "\n".join(lines[:i]).strip()
    return text


def condensed_profile(profile: dict) -> dict:
    return {
        "headline": profile.get("headline"),
        "years_experience": profile.get("years_experience"),
        "skills": profile.get("skills"),
        "roles": [
            {"role": e.get("role"), "company": e.get("company"), "from": e.get("start"), "to": e.get("end")}
            for e in profile.get("experience") or []
        ],
        "projects": [{"name": p.get("name"), "tech": p.get("tech")} for p in profile.get("projects") or []],
    }


def build_prompt(jobs: list[Job], profile: dict, cfg: SearchConfig) -> str:
    payload = {
        "candidate": condensed_profile(profile),
        "tracks": {name: t.label for name, t in cfg.tracks.items()},
        "jobs": [
            {
                "job_id": job.id,
                "title": job.title,
                "company": job.company,
                "location": job.location,
                "stated_min_years": job.min_years,
                "description": strip_boilerplate(job.description)[:SCORING_JD_CHARS],
            }
            for job in jobs
        ],
    }
    return json.dumps(payload, ensure_ascii=False, indent=1)


def score_jobs(
    jobs: list[Job], profile: dict, cfg: SearchConfig, ledger: Ledger, models: list[str]
) -> dict[str, JobScore]:
    """Returns scores keyed by job id. A failed batch is skipped (its jobs are scored next run); scoring
    stops early, keeping what it has, when every model is out of quota or two batches in a row fail."""
    system = read_prompt("score.md")
    size = max(1, cfg.limits.score_batch_size)
    scores: dict[str, JobScore] = {}
    failures = 0
    for i in range(0, len(jobs), size):
        batch = jobs[i : i + size]
        try:
            result = ledger.call(
                purpose="score",
                models=models,
                system=system,
                user=build_prompt(batch, profile, cfg),
                schema=ScoreBatch,
                max_output_tokens=8192,
            )
        except LLMError:
            failures += 1
            if failures >= 2 or all(m in ledger.exhausted for m in models):
                break
            continue
        failures = 0
        valid = {j.id for j in batch}
        for item in result.results:
            if item.job_id in valid:
                item.score = max(0, min(100, item.score))
                scores[item.job_id] = item
    return scores
