"""Batch job scoring with a cheap model: several JDs per request to stay inside free-tier request caps."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field, PrivateAttr

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


STALE_DAYS = 30

# The fit score, weighted like a recruiter's screen. Skills, experience and education are measured in code;
# the model rates the three judgement calls (domain, seniority, projects).
FIT_WEIGHTS = {"skills": 3, "experience": 2, "domain": 2, "seniority": 2, "projects": 1, "education": 1}
FIT_LABELS = {
    "skills": "Required skills",
    "experience": "Experience",
    "domain": "Domain",
    "seniority": "Seniority",
    "projects": "Similar work",
    "education": "Education",
}


class Rating(BaseModel):
    value: int  # 0-10
    note: str = ""


class FitRatings(BaseModel):
    domain: Rating
    seniority: Rating
    projects: Rating


def fit_label(score: int) -> str:
    return "Strong fit" if score >= 80 else "Moderate fit" if score >= 60 else "Stretch"


class JobScore(BaseModel):
    job_id: str
    score: int
    track: str
    reason: str
    missing_keywords: list[str]
    required_skills: list[str] = Field(default_factory=list)
    preferred_skills: list[str] = Field(default_factory=list)
    degree_required: bool = False
    # career-ops style evaluation: a do-not-apply verdict, and posting legitimacy kept separate from fit
    verdict: Literal["apply", "maybe", "skip"] = "maybe"
    legitimacy: Literal["high", "caution", "suspicious"] = "high"
    signals: list[str] = Field(default_factory=list)
    hard_stops: list[str] = Field(default_factory=list)
    fit: FitRatings | None = None
    _breakdown: dict | None = PrivateAttr(default=None)

    @property
    def breakdown(self) -> dict | None:
        return self._breakdown

    def weigh_fit(self, job: Job, profile: dict, known_skills: list[str] | None = None) -> None:
        """Replace the model's overall score with the weighted fit, and keep each part with its reason."""
        from jobbot.ats.skills import canonical_set, profile_vocabulary

        if self.fit is None:
            return
        parts: dict[str, tuple[float, str]] = {}
        required = sorted(canonical_set(self.required_skills))
        if required:
            have = canonical_set(profile_vocabulary(profile, known_skills))
            got = [s for s in required if s in have]
            missing = [s for s in required if s not in have][:3]
            note = f"{len(got)} of {len(required)}" + (f"; missing {', '.join(missing)}" if missing else "")
            parts["skills"] = (len(got) / len(required), note)
        years = float(profile.get("years_experience") or 0)
        if job.min_years is None:
            parts["experience"] = (1.0, f"{years:g} years; the ad states no minimum")
        else:
            short = job.min_years - years
            value = 1.0 if short <= 0 else 0.7 if short <= 1 else 0.4 if short <= 2 else 0.1
            parts["experience"] = (value, f"{years:g} years vs {job.min_years}+ asked")
        for key in ("domain", "seniority", "projects"):
            r: Rating = getattr(self.fit, key)
            parts[key] = (max(0, min(10, r.value)) / 10, r.note.strip()[:90])
        if self.degree_required:
            has = bool(profile.get("education"))
            parts["education"] = (
                1.0 if has else 0.3,
                "degree asked; you have one" if has else "degree asked",
            )
        else:
            parts["education"] = (1.0, "no specific degree asked")
        total = sum(FIT_WEIGHTS[k] for k in parts)
        self.score = round(100 * sum(FIT_WEIGHTS[k] * v for k, (v, _) in parts.items()) / total)
        self._breakdown = {
            "score": self.score,
            "label": fit_label(self.score),
            "parts": [
                {"key": k, "label": FIT_LABELS[k], "weight": FIT_WEIGHTS[k], "value": round(v, 2), "note": n}
                for k, (v, n) in parts.items()
            ],
        }

    def apply_rules(self, job: Job, now: datetime | None = None) -> None:
        """Facts the code knows better than the model: a hard stop always means skip, and an old posting is
        flagged (legitimacy only; staleness never changes the verdict on its own)."""
        self.signals = [s for s in self.signals if s][:3]
        self.hard_stops = [s for s in self.hard_stops if s][:3]
        if self.hard_stops:
            self.verdict = "skip"
        posted = job.posted_at
        if posted is not None:
            now = now or datetime.now(UTC)
            age = (now - (posted if posted.tzinfo else posted.replace(tzinfo=UTC))).days
            if age > STALE_DAYS:
                self.signals.append(f"posted {age} days ago")
                if self.legitimacy == "high":
                    self.legitimacy = "caution"

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


def canonical_track(value: str | None, cfg: SearchConfig, fallback: str | None = None) -> str | None:
    """The model sometimes answers with a track's label ("Java backend") instead of its name ("java")."""
    squash = lambda s: re.sub(r"[^a-z0-9]", "", (s or "").lower())  # noqa: E731
    got = squash(value)
    if got:
        for name, t in cfg.tracks.items():
            if got in (squash(name), squash(t.label)):
                return name
        for name in cfg.tracks:
            if squash(name) in got:
                return name
    return fallback


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
    jobs: list[Job],
    profile: dict,
    cfg: SearchConfig,
    ledger: Ledger,
    models: list[str],
    known_skills: list[str] | None = None,
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
        valid = {j.id: j for j in batch}
        for item in result.results:
            if item.job_id in valid:
                item.score = max(0, min(100, item.score))
                item.track = canonical_track(item.track, cfg, valid[item.job_id].track) or item.track
                item.weigh_fit(valid[item.job_id], profile, known_skills)
                item.apply_rules(valid[item.job_id])
                scores[item.job_id] = item
    return scores
