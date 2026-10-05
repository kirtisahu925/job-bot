"""Workday career sites (company.wdN.myworkdayjobs.com), the job board behind many large companies' career
pages: Walmart, Salesforce, Adobe, NVIDIA and others. The site's own JSON endpoints, no key needed.

A company is stored as "tenant/wdN/site", read from its career page address:
https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite -> "nvidia/wd5/NVIDIAExternalCareerSite".
Each scan searches the site for your job titles, keeps the postings in India (or listed in several places)
and reads those postings in full."""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from jobbot.config import Company
from jobbot.http import get_json, post_json
from jobbot.models import RawJob
from jobbot.pipeline.normalize import parse_dt
from jobbot.sources.boards import _BoardSource

INDIA = re.compile(
    r"\bindia\b|bengaluru|bangalore|hyderabad|pune|gurugram|gurgaon|noida|delhi|chennai|mumbai|\bremote\b",
    re.I,
)
SEVERAL = re.compile(r"^\d+\s+locations?$", re.I)  # "3 Locations": the detail page says which
MAX_DETAILS = 10  # postings read in full per company and scan


def site_parts(slug: str) -> tuple[str, str, str]:
    tenant, dc, site = slug.split("/", 2)
    return tenant, dc, site


def site_url(slug: str) -> str:
    tenant, dc, site = site_parts(slug)
    return f"https://{tenant}.{dc}.myworkdayjobs.com/{site}"


def posted_on(text: str | None, now: datetime | None = None) -> datetime | None:
    """Workday's "Posted Today", "Posted 3 Days Ago", "Posted 30+ Days Ago"."""
    t = (text or "").lower()
    now = now or datetime.now(UTC)
    if "today" in t or "just" in t:
        return now
    if "yesterday" in t:
        return now - timedelta(days=1)
    m = re.search(r"(\d+)\s*(\+)?\s*day", t)
    return now - timedelta(days=int(m.group(1)) + (1 if m.group(2) else 0)) if m else None


class WorkdaySource(_BoardSource):
    name = "workday"

    def __init__(self, client: httpx.Client, companies: list[Company], max_age_days: int, queries: list[str]):
        super().__init__(client, companies, max_age_days)
        self.queries = list(dict.fromkeys(queries))[:3] or ["software engineer"]

    def postings(self, api: str) -> dict[str, dict[str, Any]]:
        found: dict[str, dict[str, Any]] = {}
        for query in self.queries:
            body = {"appliedFacets": {}, "limit": 20, "offset": 0, "searchText": query}
            for p in post_json(self.client, f"{api}/jobs", json=body).json().get("jobPostings") or []:
                where = p.get("locationsText") or ""
                if p.get("externalPath") and (INDIA.search(where) or SEVERAL.match(where.strip())):
                    found.setdefault(p["externalPath"], p)
        return found

    def fetch_company(self, company: Company) -> list[RawJob]:
        tenant, dc, site = site_parts(company.slug)
        api = f"https://{tenant}.{dc}.myworkdayjobs.com/wday/cxs/{tenant}/{site}"
        jobs: list[RawJob] = []
        for path, p in list(self.postings(api).items())[:MAX_DETAILS]:
            info = get_json(self.client, f"{api}{path}").json().get("jobPostingInfo") or {}
            places = [info.get("location") or p.get("locationsText") or ""] + list(
                info.get("additionalLocations") or []
            )
            where = "; ".join(x for x in places if x)
            if not INDIA.search(where):
                continue
            jobs.append(
                RawJob(
                    source="workday",
                    source_job_id=info.get("jobReqId") or path.rsplit("_", 1)[-1],
                    title=info.get("title") or p.get("title") or "",
                    company=company.name,
                    location=where,
                    remote="remote" in where.lower(),
                    url=info.get("externalUrl") or f"{site_url(company.slug)}{path}",
                    description=info.get("jobDescription") or "",
                    posted_at=parse_dt(info.get("startDate")) or posted_on(p.get("postedOn")),
                    job_type=info.get("timeType") or None,
                )
            )
        return [j for j in jobs if j.title]
