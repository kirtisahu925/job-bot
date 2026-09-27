"""Storage contract used by the pipeline. Implemented by SQLite (local/dry runs) and Supabase (production)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Protocol

from jobbot.models import ApiUsage, BalanceSnapshot, Job, LLMUsage

JOB_COLUMNS = (
    "fingerprint",
    "title",
    "company",
    "location",
    "city",
    "remote",
    "apply_url",
    "description",
    "salary_min",
    "salary_max",
    "currency",
    "posted_at",
    "track",
    "min_years",
    "prefilter_score",
    "llm_score",
    "score_reason",
    "missing_keywords",
    "status",
    "captured_by",
    "remote_region",
)


def job_row(job: Job) -> dict[str, Any]:
    data = job.model_dump(mode="json")
    return {k: data[k] for k in JOB_COLUMNS}


class Store(Protocol):
    def start_run(self, trigger: str) -> str: ...

    def finish_run(self, run_id: str, status: str, summary: dict[str, Any]) -> None: ...

    def upsert_jobs(self, run_id: str, jobs: list[Job]) -> tuple[list[Job], int]:
        """Insert unseen jobs, attach new links to known ones. Returns (new jobs with ids, known count)."""
        ...

    def unscored_jobs(self, limit: int, since: datetime) -> list[Job]: ...

    def update_job(self, job_id: str, fields: dict[str, Any]) -> None: ...

    def tailor_candidates(self, limit: int, min_score: int) -> list[Job]:
        """Jobs queued from the dashboard/extension first, then the best-scoring untailored new jobs."""
        ...

    def save_tailoring(
        self, job_id: str, record: dict[str, Any], tex: bytes | None, pdf: bytes | None
    ) -> dict: ...

    def record_api_usage(self, run_id: str, rows: list[ApiUsage]) -> None: ...

    def record_llm_usage(self, run_id: str, rows: list[LLMUsage]) -> None: ...

    def record_balances(self, run_id: str, rows: list[BalanceSnapshot]) -> None: ...

    def llm_requests_since(self, since: datetime) -> dict[str, int]: ...

    def llm_cost_since(self, provider: str, since: datetime) -> float: ...

    def api_calls_since(self, source: str, since: datetime) -> int: ...

    def api_cost_since(self, source: str, since: datetime) -> float: ...

    def topups(self, provider: str) -> list[dict[str, Any]]: ...
