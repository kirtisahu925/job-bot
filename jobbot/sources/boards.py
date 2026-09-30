"""Company career boards with official public APIs: Greenhouse, Lever and Ashby (no key needed)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from jobbot.config import Company
from jobbot.http import get_json, status_of
from jobbot.models import RawJob, SourceResult
from jobbot.pipeline.normalize import parse_dt
from jobbot.sources.base import Source


class _BoardSource(Source):
    def __init__(self, client: httpx.Client, companies: list[Company], max_age_days: int = 30):
        self.client = client
        self.companies = companies
        self.max_age = timedelta(days=max_age_days)

    def fetch_company(self, company: Company) -> list[RawJob]:
        raise NotImplementedError

    def fetch(self) -> SourceResult:
        result = SourceResult(source=self.name)
        failures: list[str] = []
        cutoff = datetime.now(UTC) - self.max_age
        for company in self.companies:
            result.calls += 1
            try:
                jobs = self.fetch_company(company)
            except Exception as exc:  # noqa: BLE001 - one bad slug must not hide the rest
                failures.append(f"{company.slug}: {status_of(exc)}")
                continue
            result.jobs.extend(j for j in jobs if j.posted_at is None or j.posted_at >= cutoff)
        if failures:
            result.error = ", ".join(failures)
            if len(failures) == len(self.companies):
                result.status = "error"
        return result


class GreenhouseSource(_BoardSource):
    name = "greenhouse"

    @staticmethod
    def parse(payload: dict[str, Any], company_name: str) -> list[RawJob]:
        return [
            RawJob(
                source="greenhouse",
                source_job_id=str(j.get("id")),
                title=j.get("title", ""),
                company=company_name,
                location=(j.get("location") or {}).get("name", ""),
                url=j.get("absolute_url", ""),
                description=j.get("content", ""),
                posted_at=parse_dt(j.get("updated_at") or j.get("first_published")),
            )
            for j in payload.get("jobs", [])
            if j.get("title") and j.get("absolute_url")
        ]

    def fetch_company(self, company: Company) -> list[RawJob]:
        url = f"https://boards-api.greenhouse.io/v1/boards/{company.slug}/jobs"
        return self.parse(get_json(self.client, url, params={"content": "true"}).json(), company.name)


class LeverSource(_BoardSource):
    name = "lever"

    @staticmethod
    def parse(payload: list[dict[str, Any]], company_name: str) -> list[RawJob]:
        jobs = []
        for p in payload:
            cats = p.get("categories") or {}
            desc = p.get("descriptionPlain") or ""
            for block in p.get("lists") or []:
                desc += f"\n\n{block.get('text', '')}\n{block.get('content', '')}"
            desc += "\n\n" + (p.get("additionalPlain") or "")
            jobs.append(
                RawJob(
                    source="lever",
                    source_job_id=p.get("id"),
                    title=p.get("text", ""),
                    company=company_name,
                    location=cats.get("location") or "",
                    remote=(p.get("workplaceType") == "remote"),
                    url=p.get("hostedUrl", ""),
                    apply_url=p.get("applyUrl"),
                    description=desc,
                    posted_at=parse_dt(p.get("createdAt")),
                    job_type=cats.get("commitment") or None,
                )
            )
        return [j for j in jobs if j.title and j.url]

    def fetch_company(self, company: Company) -> list[RawJob]:
        url = f"https://api.lever.co/v0/postings/{company.slug}"
        return self.parse(get_json(self.client, url, params={"mode": "json"}).json(), company.name)


class AshbySource(_BoardSource):
    name = "ashby"

    @staticmethod
    def parse(payload: dict[str, Any], company_name: str) -> list[RawJob]:
        jobs = []
        for j in payload.get("jobs", []):
            locs = [j.get("location") or ""] + [
                s.get("location", "") for s in j.get("secondaryLocations") or []
            ]
            jobs.append(
                RawJob(
                    source="ashby",
                    source_job_id=j.get("id"),
                    title=j.get("title", ""),
                    company=company_name,
                    location=", ".join(x for x in locs if x),
                    remote=bool(j.get("isRemote")),
                    url=j.get("jobUrl", ""),
                    apply_url=j.get("applyUrl"),
                    description=j.get("descriptionPlain") or j.get("descriptionHtml") or "",
                    posted_at=parse_dt(j.get("publishedAt")),
                    job_type=j.get("employmentType") or None,
                )
            )
        return [j for j in jobs if j.title and j.url]

    def fetch_company(self, company: Company) -> list[RawJob]:
        url = f"https://api.ashbyhq.com/posting-api/job-board/{company.slug}"
        return self.parse(
            get_json(self.client, url, params={"includeCompensation": "true"}).json(), company.name
        )


def probe(client: httpx.Client, slug: str) -> dict[str, str]:
    """Which board (if any) serves this company slug, and how many open jobs it has."""
    checks = {
        "greenhouse": (
            f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs",
            lambda d: len(d.get("jobs", [])),
        ),
        "lever": (f"https://api.lever.co/v0/postings/{slug}?mode=json", lambda d: len(d)),
        "ashby": (f"https://api.ashbyhq.com/posting-api/job-board/{slug}", lambda d: len(d.get("jobs", []))),
    }
    out = {}
    for board, (url, count) in checks.items():
        try:
            resp = client.get(url)
            out[board] = (
                f"{count(resp.json())} jobs" if resp.status_code == 200 else f"HTTP {resp.status_code}"
            )
        except Exception as exc:  # noqa: BLE001
            out[board] = f"error: {exc}"
    return out
