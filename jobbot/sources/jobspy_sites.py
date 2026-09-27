"""LinkedIn, Indeed and Naukri through python-jobspy (public listings, no login).

Each (site, query) pair is scraped separately so one blocked call does not lose the others.
"""

from __future__ import annotations

import logging
import math
import time
from typing import Any

from jobbot.http import status_of
from jobbot.models import RawJob, SourceResult
from jobbot.pipeline.normalize import parse_dt
from jobbot.sources.base import Source

log = logging.getLogger(__name__)


def _clean(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if hasattr(value, "item") and not isinstance(value, (str, bytes)):
        try:
            return value.item()
        except (ValueError, AttributeError):
            return value
    return value


def rows_to_jobs(site: str, rows: list[dict[str, Any]]) -> list[RawJob]:
    jobs: list[RawJob] = []
    for row in rows:
        r = {k: _clean(v) for k, v in row.items()}
        title, url = r.get("title"), r.get("job_url")
        if not title or not url:
            continue
        direct = r.get("job_url_direct")
        jobs.append(
            RawJob(
                source=site,
                source_job_id=str(r.get("id")) if r.get("id") is not None else None,
                title=str(title),
                company=str(r.get("company") or "Unknown"),
                location=str(r.get("location") or ""),
                remote=bool(r.get("is_remote") or False),
                url=str(url),
                apply_url=str(direct) if direct else None,
                description=str(r.get("description") or ""),
                salary_min=r.get("min_amount"),
                salary_max=r.get("max_amount"),
                currency=r.get("currency"),
                posted_at=parse_dt(r.get("date_posted")),
                experience_text=r.get("experience_range"),
            )
        )
    return jobs


class JobSpySource(Source):
    def __init__(
        self, site: str, queries: list[str], conf: dict[str, Any], scraper=None, pause_s: float = 3.0
    ):
        self.name = site
        self.queries = queries
        self.conf = conf
        self._scraper = scraper
        self.pause_s = pause_s

    def _scrape(self, **kwargs):
        if self._scraper is not None:
            return self._scraper(**kwargs)
        from jobspy import scrape_jobs  # heavy import (pandas); only when actually scraping

        return scrape_jobs(**kwargs)

    def fetch(self) -> SourceResult:
        result = SourceResult(source=self.name)
        errors: list[tuple[str, str]] = []
        for i, query in enumerate(self.queries):
            if i:
                time.sleep(self.pause_s)
            result.calls += 1
            try:
                df = self._scrape(
                    site_name=[self.name],
                    search_term=query,
                    location=self.conf.get("location") or None,
                    results_wanted=int(self.conf.get("results_wanted", 30)),
                    hours_old=int(self.conf.get("hours_old", 13)),
                    country_indeed="India",
                    linkedin_fetch_description=bool(self.conf.get("fetch_description", False)),
                    description_format="markdown",
                    verbose=0,
                )
            except Exception as exc:  # noqa: BLE001
                errors.append((status_of(exc), str(exc)[:200]))
                continue
            rows = df.to_dict("records") if df is not None and not df.empty else []
            result.jobs.extend(rows_to_jobs(self.name, rows))

        if errors and len(errors) == len(self.queries):
            result.status = "blocked" if any(s == "blocked" for s, _ in errors) else errors[0][0]
            result.error = "; ".join(msg for _, msg in errors)
        elif not result.jobs:
            result.status = "empty"
            result.error = "; ".join(msg for _, msg in errors) or "no results (possibly rate-limited)"
        elif errors:
            result.error = f"{len(errors)} of {len(self.queries)} queries failed: " + errors[0][1]
        return result
