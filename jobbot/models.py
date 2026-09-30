"""Data shapes shared by sources, pipeline, stores and the tailoring engine."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

SourceStatus = Literal["ok", "empty", "blocked", "broken", "error", "timeout", "skipped"]

JOB_STATUSES = (
    "new",
    "shortlisted",
    "tailor_queued",
    "tailored",
    "applied",
    "interviewing",
    "offer",
    "rejected",
    "expired",  # the posting stopped taking applications ("No longer accepting applications")
    "skipped",
    "archived",
)


class RawJob(BaseModel):
    """One posting as a source returned it, before normalization."""

    source: str
    source_job_id: str | None = None
    title: str
    company: str
    location: str = ""
    remote: bool = False
    url: str
    apply_url: str | None = None
    description: str = ""
    salary_min: float | None = None
    salary_max: float | None = None
    currency: str | None = None
    posted_at: datetime | None = None
    experience_text: str | None = None
    remote_region: str | None = None
    # as the site states it, e.g. "fulltime, internship" or "INTERN"; used by the filters only
    job_type: str | None = None


class SourceResult(BaseModel):
    source: str
    jobs: list[RawJob] = Field(default_factory=list)
    calls: int = 0
    cost_usd: float = 0.0
    status: SourceStatus = "ok"
    error: str | None = None
    remaining: int | None = None  # quota left, when the source reports it

    @property
    def results(self) -> int:
        return len(self.jobs)


class JobLink(BaseModel):
    source: str
    url: str
    url_key: str
    source_job_id: str | None = None


class Job(BaseModel):
    """A normalized, deduplicated job, possibly seen on several sites."""

    id: str | None = None
    fingerprint: str
    title: str
    company: str
    location: str = ""
    city: str | None = None
    remote: bool = False
    apply_url: str
    description: str = ""
    salary_min: float | None = None
    salary_max: float | None = None
    currency: str | None = None
    posted_at: datetime | None = None
    track: str | None = None
    min_years: int | None = None
    prefilter_score: float = 0.0
    llm_score: int | None = None
    score_reason: str | None = None
    missing_keywords: list[str] = Field(default_factory=list)
    status: str = "new"
    captured_by: str = "bot"
    links: list[JobLink] = Field(default_factory=list)
    remote_region: str | None = None
    experience_text: str | None = None
    job_type: str | None = None  # from the site, used by the filters, not stored
    jd_keywords: dict | None = None
    ats_score: int | None = None

    @property
    def sources(self) -> list[str]:
        return sorted({link.source for link in self.links})


class ApiUsage(BaseModel):
    source: str
    calls: int
    results: int
    status: str
    cost_usd: float = 0.0
    remaining: int | None = None
    error: str | None = None


class LLMUsage(BaseModel):
    provider: str
    model: str
    purpose: str
    input_tokens: int = 0
    output_tokens: int = 0
    thinking_tokens: int = 0
    cached_tokens: int = 0
    latency_ms: int = 0
    status: str = "ok"  # ok | rate_limited | error | skipped_cap
    cost_usd: float = 0.0
    shadow_cost_usd: float = 0.0
    error: str | None = None
    job_id: str | None = None


class BalanceSnapshot(BaseModel):
    provider: str
    kind: Literal["money", "quota"]
    unit: str  # USD | requests | calls
    used: float
    limit: float | None = None
    remaining: float | None = None
    period: str  # day | month | lifetime
    method: Literal["live_api", "ledger", "manual"]
    note: str | None = None

    @property
    def low(self) -> bool:
        if self.limit in (None, 0) or self.remaining is None:
            return False
        return self.remaining / self.limit < 0.20
