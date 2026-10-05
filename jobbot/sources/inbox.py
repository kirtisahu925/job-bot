"""Jobs you saved in bulk from a job site's search page with the extension (the job_inbox table, migration
0011). Naukri blocks requests from GitHub's servers, but not your own browser: the extension reads the
search page you have open, and the next scan takes those jobs through the same filters and scoring as the
rest. Each row is used once; the run marks it processed after the jobs are stored."""

from __future__ import annotations

from jobbot.models import RawJob, SourceResult
from jobbot.pipeline.normalize import parse_dt
from jobbot.sources.base import Source


class InboxSource(Source):
    name = "inbox"

    def __init__(self, store, limit: int = 500):
        self.store, self.limit = store, limit
        self.ids: list[str] = []

    def fetch(self) -> SourceResult:
        rows = self.store.job_inbox(self.limit)
        self.ids = [r["id"] for r in rows]
        jobs = [
            RawJob(
                source=r["source"],
                source_job_id=r["url_key"].split(":", 1)[1] if ":" in r["url_key"] else None,
                title=r["title"],
                company=r["company"],
                location=r.get("location") or "",
                url=r["url"],
                description=r.get("description") or "",
                posted_at=parse_dt(r.get("posted_at")),
                experience_text=r.get("experience_text"),
                job_type=r.get("job_type"),
            )
            for r in rows
        ]
        return SourceResult(source=self.name, jobs=jobs, calls=1, status="ok" if jobs else "empty")
