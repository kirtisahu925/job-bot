"""Cheap, deterministic filters and ranking that run before any LLM call."""

from __future__ import annotations

import re
from collections import Counter
from datetime import UTC, datetime, timedelta

from jobbot.config import SearchConfig
from jobbot.models import Job

_UNIT = r"(?:years?|yrs?)"
_RANGE = re.compile(rf"(\d{{1,2}})\s*(?:-|–|—|to)\s*(\d{{1,2}})\s*\+?\s*{_UNIT}", re.I)
_PLUS = re.compile(rf"(\d{{1,2}})\s*(?:\+|plus)\s*{_UNIT}", re.I)
_MIN = re.compile(rf"(?:minimum|min\.?|at\s*least|atleast)\s*(?:of\s*)?(\d{{1,2}})\s*\+?\s*{_UNIT}", re.I)
_PLAIN = re.compile(rf"(\d{{1,2}})\s*{_UNIT}\s*(?:of\s*)?(?:\w+\s+){{0,3}}(?:experience|exp\b)", re.I)
_EXP_CONTEXT = re.compile(r"experience|exp\b|work(?:ing)?\b|industry|professional|hands[- ]on", re.I)


def _term_re(term: str) -> re.Pattern[str]:
    # word-ish boundaries that also work for terms like ".net" and "c#"
    return re.compile(rf"(?<![a-z0-9]){re.escape(term.lower())}(?![a-z0-9])")


def min_years_required(text: str, experience_text: str | None = None) -> int | None:
    """Largest stated minimum experience in the ad, or None when it says nothing usable.

    Taking the largest minimum is deliberate: "5+ years Java, 2+ years Kafka" means 5.
    """
    if experience_text:
        m = re.search(r"(\d{1,2})", experience_text)
        if m:
            return int(m.group(1))
    mins: list[int] = []
    taken: list[tuple[int, int]] = []  # spans already claimed, so "2-4 years" is not also read as "4 years"
    for pattern in (_RANGE, _PLUS, _MIN, _PLAIN):
        for m in pattern.finditer(text):
            if any(m.start() < end and start < m.end() for start, end in taken):
                continue
            window = text[max(0, m.start() - 60) : m.end() + 60]
            if pattern is not _PLAIN and not _EXP_CONTEXT.search(window):
                continue
            value = int(m.group(1))
            if 0 <= value <= 25:
                mins.append(value)
                taken.append(m.span())
    return max(mins) if mins else None


class Filters:
    def __init__(self, cfg: SearchConfig):
        self.cfg = cfg
        self.include = [_term_re(t) for t in cfg.title_include]
        self.exclude = [_term_re(t) for t in cfg.title_exclude]
        self.track_terms = {name: [_term_re(k) for k in t.keywords] for name, t in cfg.tracks.items()}
        self.remote_regions = [r.lower() for r in cfg.locations.remote_regions]

    def title_ok(self, title: str) -> bool:
        t = title.lower()
        return any(p.search(t) for p in self.include) and not any(p.search(t) for p in self.exclude)

    def location_ok(self, job: Job) -> bool:
        if job.city:
            return True
        if job.remote and self.cfg.locations.include_remote:
            region = (job.remote_region or "").lower()
            return not region or any(r in region for r in self.remote_regions)
        return False

    def track_of(self, job: Job) -> str | None:
        title, desc = job.title.lower(), job.description.lower()
        scores = {
            name: sum(3 for p in terms if p.search(title)) + sum(1 for p in terms if p.search(desc))
            for name, terms in self.track_terms.items()
        }
        best = max(scores, key=scores.get) if scores else None
        return best if best and scores[best] > 0 else None

    def apply(self, jobs: list[Job]) -> tuple[list[Job], Counter]:
        """Returns kept jobs (with track and min_years set) and a count of drop reasons."""
        kept: list[Job] = []
        dropped: Counter = Counter()
        for job in jobs:
            if not self.title_ok(job.title):
                dropped["title"] += 1
                continue
            if not self.location_ok(job):
                dropped["location"] += 1
                continue
            job.min_years = min_years_required(job.description, job.experience_text)
            if job.min_years is not None and job.min_years > self.cfg.max_required_years:
                dropped["experience"] += 1
                continue
            job.track = self.track_of(job)
            kept.append(job)
        return kept, dropped


def skill_vocabulary(profile: dict) -> list[str]:
    vocab: list[str] = []
    for items in (profile.get("skills") or {}).values():
        vocab.extend(items or [])
    vocab.extend(profile.get("extra_vocabulary") or [])
    for project in profile.get("projects") or []:
        vocab.extend(project.get("tech") or [])
    seen: set[str] = set()
    out = []
    for v in vocab:
        key = v.lower().strip()
        if key and key not in seen:
            seen.add(key)
            out.append(v)
    return out


def prerank(jobs: list[Job], profile: dict, now: datetime | None = None) -> list[Job]:
    """Orders jobs by skill overlap with the profile plus a small freshness bonus."""
    now = now or datetime.now(UTC)
    vocab = [_term_re(v) for v in skill_vocabulary(profile)]
    for job in jobs:
        text = f"{job.title}\n{job.description}".lower()
        hits = sum(1 for p in vocab if p.search(text))
        overlap = hits / max(len(vocab), 1)
        fresh = 0.0
        if job.posted_at and now - job.posted_at < timedelta(days=2):
            fresh = 0.1
        job.prefilter_score = round(min(1.0, overlap * 2) + fresh, 4)
    return sorted(jobs, key=lambda j: j.prefilter_score, reverse=True)
