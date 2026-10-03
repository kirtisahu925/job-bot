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

# Internships posted under a plain title ("Java Backend Developer") say so in the site's job type or in the
# ad itself. Benefits text ("internet stipend", "unpaid leave") must not trip it, so only these count.
_INTERN_TYPE = re.compile(r"intern", re.I)
_INTERN_LEAD = re.compile(r"\b(?:interns?|internships?)\b", re.I)  # in the ad's opening lines
_INTERN_ANYWHERE = re.compile(
    r"\binternship\s+(?:opportunity|type|duration|program(?:me)?|role|position|period|offer)\b"
    r"|\b(?:job|employment|position|engagement)\s+type\s*[:\-]?\s*(?:full[- ]?time\s+|part[- ]?time\s+)?internship"
    r"|\bunpaid\s+(?:internship|intern|role|position|project)"
    r"|\bintern(?:ship)?\s*\(\s*\d+\s*(?:months?|weeks?|days?)\s*\)"
    r"|\bposition\s*:\s*[^\n.]{0,60}\bintern\b",
    re.I,
)


def is_internship(job: Job) -> bool:
    if job.job_type and _INTERN_TYPE.search(job.job_type):
        return True
    return bool(_INTERN_LEAD.search(job.description[:300]) or _INTERN_ANYWHERE.search(job.description))


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


_SUFFIXES = {
    "pvt",
    "private",
    "ltd",
    "limited",
    "inc",
    "llc",
    "llp",
    "plc",
    "corp",
    "corporation",
    "co",
    "the",
    "india",
}


def company_tokens(name: str) -> list[str]:
    """A company name as comparable words: lower case, no punctuation or legal suffixes ("Infosys Limited" and
    "infosys" are the same company)."""
    words = re.findall(r"[a-z0-9]+", name.lower().replace("&", " and "))
    return [w for w in words if w not in _SUFFIXES]


def same_company(listed: str, company: str) -> bool:
    """`company` is `listed` or one of its divisions: "Infosys" matches "Infosys BPM", never "Infosysly"."""
    want, got = company_tokens(listed), company_tokens(company)
    return bool(want) and got[: len(want)] == want


class Filters:
    def __init__(self, cfg: SearchConfig):
        self.cfg = cfg
        self.skip_companies = [*cfg.skip_companies, *(cfg.it_services if cfg.skip_it_services else [])]
        self.deal_breakers = [_term_re(p.lower()) for p in cfg.skip_phrases if p.strip()]
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

    def salary_ok(self, job: Job) -> bool:
        """Only a stated INR salary can fail the dashboard's minimum; most ads state none and pass."""
        floor = self.cfg.candidate.get("min_salary_lpa")
        top = job.salary_max or job.salary_min
        if not floor or not top or (job.currency or "INR").upper() != "INR":
            return True
        return top >= float(floor) * 100_000

    def track_of(self, job: Job) -> str | None:
        title, desc = job.title.lower(), job.description.lower()
        scores = {
            name: sum(3 for p in terms if p.search(title)) + sum(1 for p in terms if p.search(desc))
            for name, terms in self.track_terms.items()
        }
        best = max(scores, key=scores.get) if scores else None
        return best if best and scores[best] > 0 else None

    def recent(self, job: Job, now: datetime) -> bool:
        """Posted within the Preferences window, by calendar day (many sites give only a date). A job with no
        posting date is kept: there is nothing to judge it by."""
        days = self.cfg.max_job_age_days
        if not days or job.posted_at is None:
            return True
        return job.posted_at.date() >= (now - timedelta(days=days)).date()

    def apply(self, jobs: list[Job], now: datetime | None = None) -> tuple[list[Job], Counter]:
        """Returns kept jobs (with track and min_years set) and a count of drop reasons."""
        now = now or datetime.now(UTC)
        kept: list[Job] = []
        dropped: Counter = Counter()
        for job in jobs:
            if not self.recent(job, now):
                dropped["too old"] += 1
                continue
            if not self.title_ok(job.title):
                dropped["title"] += 1
                continue
            if any(same_company(c, job.company) for c in self.skip_companies):
                dropped["skipped company"] += 1
                continue
            if self.deal_breakers:
                text = f"{job.title}\n{job.description}".lower()
                if any(p.search(text) for p in self.deal_breakers):
                    dropped["deal-breaker"] += 1
                    continue
            if is_internship(job):
                dropped["internship"] += 1
                continue
            if not self.location_ok(job):
                dropped["location"] += 1
                continue
            if not self.salary_ok(job):
                dropped["salary"] += 1
                continue
            job.min_years = min_years_required(job.description, job.experience_text)
            if job.min_years is not None and job.min_years > self.cfg.max_required_years:
                dropped["experience"] += 1
                continue
            job.track = self.track_of(job)
            kept.append(job)
        return kept, dropped


def skill_vocabulary(profile: dict, extra: list[str] | None = None) -> list[str]:
    from jobbot.ats.skills import profile_vocabulary

    return profile_vocabulary(profile, extra)


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
