"""Official job APIs: Adzuna, JSearch (RapidAPI), Jooble and Remotive."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import httpx

from jobbot.http import get_json, post_json
from jobbot.models import RawJob, SourceResult
from jobbot.pipeline.normalize import parse_dt
from jobbot.sources.base import Source


class AdzunaSource(Source):
    name = "adzuna"
    URL = "https://api.adzuna.com/v1/api/jobs/in/search/{page}"

    def __init__(self, client, app_id, app_key, queries, conf, calls_today: Callable[[str], int]):
        self.client, self.app_id, self.app_key, self.queries = client, app_id, app_key, queries
        self.pages = int(conf.get("pages", 2))
        self.daily_cap = int(conf.get("daily_cap", 200))
        self.max_days_old = int(conf.get("max_days_old", 1))
        self.calls_today = calls_today

    @staticmethod
    def parse(payload: dict[str, Any]) -> list[RawJob]:
        jobs = []
        for r in payload.get("results", []):
            loc = (r.get("location") or {}).get("display_name", "")
            jobs.append(
                RawJob(
                    source="adzuna",
                    source_job_id=str(r.get("id")),
                    title=r.get("title", ""),
                    company=(r.get("company") or {}).get("display_name") or "Unknown",
                    location=loc,
                    url=r.get("redirect_url", ""),
                    description=r.get("description", ""),
                    salary_min=r.get("salary_min"),
                    salary_max=r.get("salary_max"),
                    currency="INR" if r.get("salary_min") else None,
                    posted_at=parse_dt(r.get("created")),
                )
            )
        return [j for j in jobs if j.title and j.url]

    def fetch(self) -> SourceResult:
        if not (self.app_id and self.app_key):
            return SourceResult(
                source=self.name, status="skipped", error="ADZUNA_APP_ID/ADZUNA_APP_KEY not set"
            )
        result = SourceResult(source=self.name)
        used = self.calls_today(self.name)
        for query in self.queries:
            for page in range(1, self.pages + 1):
                if used + result.calls >= self.daily_cap:
                    result.error = f"daily cap {self.daily_cap} reached"
                    break
                result.calls += 1
                resp = get_json(
                    self.client,
                    self.URL.format(page=page),
                    params={
                        "app_id": self.app_id,
                        "app_key": self.app_key,
                        "what": query,
                        "max_days_old": self.max_days_old,
                        "results_per_page": 50,
                        "content-type": "application/json",
                    },
                )
                page_jobs = self.parse(resp.json())
                result.jobs.extend(page_jobs)
                if len(page_jobs) < 50:
                    break
        result.remaining = max(self.daily_cap - used - result.calls, 0)
        if not result.jobs and result.status == "ok":
            result.status = "empty"
        return result


class JSearchSource(Source):
    """Google for Jobs via RapidAPI: picks up LinkedIn, Indeed, Glassdoor and Naukri listings."""

    name = "jsearch"
    URL = "https://jsearch.p.rapidapi.com/search-v2"

    def __init__(self, client, api_key, queries, conf, calls_this_month: Callable[[str], int]):
        self.client, self.api_key, self.queries = client, api_key, queries
        self.monthly_cap = int(conf.get("monthly_cap", 190))
        self.url = conf.get("url") or self.URL
        self.date_posted = conf.get("date_posted", "today")  # all | today | 3days | week | month
        self.calls_this_month = calls_this_month

    @staticmethod
    def parse(payload: dict[str, Any]) -> list[RawJob]:
        data = payload.get("data") or []
        # /search-v2 wraps the list as {"jobs": [...], "cursor": ...}; the retired /search returned the list itself
        rows = (data.get("jobs") or []) if isinstance(data, dict) else data
        jobs = []
        for r in rows:
            parts = [r.get("job_city"), r.get("job_state"), r.get("job_country")]
            jobs.append(
                RawJob(
                    source="jsearch",
                    source_job_id=r.get("job_id"),
                    title=r.get("job_title") or "",
                    company=r.get("employer_name") or "Unknown",
                    location=", ".join(p for p in parts if p) or r.get("job_location") or "",
                    remote=bool(r.get("job_is_remote")),
                    url=r.get("job_google_link") or r.get("job_apply_link") or "",
                    apply_url=r.get("job_apply_link"),
                    description=r.get("job_description") or "",
                    salary_min=r.get("job_min_salary"),
                    salary_max=r.get("job_max_salary"),
                    currency=r.get("job_salary_currency"),
                    posted_at=parse_dt(r.get("job_posted_at_datetime_utc")),
                    job_type=", ".join(r.get("job_employment_types") or []) or r.get("job_employment_type"),
                )
            )
        return [j for j in jobs if j.title and j.url]

    def fetch(self) -> SourceResult:
        if not self.api_key:
            return SourceResult(source=self.name, status="skipped", error="RAPIDAPI_KEY not set")
        result = SourceResult(source=self.name)
        used = self.calls_this_month(self.name)
        headers = {"X-RapidAPI-Key": self.api_key, "X-RapidAPI-Host": httpx.URL(self.url).host}
        for query in self.queries:
            if used + result.calls >= self.monthly_cap:
                result.error = f"monthly cap {self.monthly_cap} reached"
                break
            result.calls += 1
            resp = get_json(
                self.client,
                self.url,
                headers=headers,
                params={
                    "query": f"{query} in India",
                    "num_pages": 1,
                    "country": "in",
                    "date_posted": self.date_posted,
                },
            )
            remaining = resp.headers.get("x-ratelimit-requests-remaining")
            if remaining is not None and remaining.isdigit():
                result.remaining = int(remaining)
            result.jobs.extend(self.parse(resp.json()))
        if result.remaining is None:
            result.remaining = max(self.monthly_cap - used - result.calls, 0)
        if not result.jobs and result.status == "ok":
            result.status = "empty"
        return result


class JoobleSource(Source):
    name = "jooble"

    def __init__(self, client, api_key, queries, conf, calls_today: Callable[[str], int]):
        self.client, self.api_key, self.queries = client, api_key, queries
        self.daily_cap = int(conf.get("daily_cap", 100))
        self.calls_today = calls_today

    @staticmethod
    def parse(payload: dict[str, Any]) -> list[RawJob]:
        return [
            RawJob(
                source="jooble",
                source_job_id=str(r.get("id")) if r.get("id") else None,
                title=r.get("title") or "",
                company=r.get("company") or "Unknown",
                location=r.get("location") or "",
                url=r.get("link") or "",
                description=r.get("snippet") or "",
                posted_at=parse_dt(r.get("updated")),
                job_type=r.get("type") or None,
            )
            for r in payload.get("jobs") or []
            if r.get("title") and r.get("link")
        ]

    def fetch(self) -> SourceResult:
        if not self.api_key:
            return SourceResult(source=self.name, status="skipped", error="JOOBLE_API_KEY not set")
        result = SourceResult(source=self.name)
        used = self.calls_today(self.name)
        for query in self.queries:
            if used + result.calls >= self.daily_cap:
                break
            result.calls += 1
            resp = post_json(
                self.client,
                f"https://jooble.org/api/{self.api_key}",
                json={"keywords": query, "location": "India"},
            )
            result.jobs.extend(self.parse(resp.json()))
        result.remaining = max(self.daily_cap - used - result.calls, 0)
        if not result.jobs:
            result.status = "empty"
        return result


class RemotiveSource(Source):
    """Remote-only roles. Remotive asks for a few calls a day at most: one per run."""

    name = "remotive"
    URL = "https://remotive.com/api/remote-jobs"

    def __init__(self, client: httpx.Client, queries: list[str]):
        self.client = client
        self.queries = queries

    @staticmethod
    def parse(payload: dict[str, Any]) -> list[RawJob]:
        return [
            RawJob(
                source="remotive",
                source_job_id=str(r.get("id")),
                title=r.get("title") or "",
                company=r.get("company_name") or "Unknown",
                location=f"Remote ({r.get('candidate_required_location') or 'Anywhere'})",
                remote=True,
                remote_region=r.get("candidate_required_location") or "Anywhere",
                url=r.get("url") or "",
                description=r.get("description") or "",
                posted_at=parse_dt(r.get("publication_date")),
                job_type=r.get("job_type") or None,
            )
            for r in payload.get("jobs") or []
            if r.get("title") and r.get("url")
        ]

    def fetch(self) -> SourceResult:
        resp = get_json(self.client, self.URL, params={"category": "software-dev", "limit": 150})
        result = SourceResult(source=self.name, calls=1, jobs=self.parse(resp.json()))
        if not result.jobs:
            result.status = "empty"
        return result
