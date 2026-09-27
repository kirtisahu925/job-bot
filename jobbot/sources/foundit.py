"""Foundit (formerly Monster India) via the JSON its own search page calls.

This is not an official API. The response shape has varied over time, so parsing tries several known
field names and reports status "broken" when none match, instead of silently returning nothing.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote_plus

import httpx

from jobbot.http import BROWSER_UA, get_json
from jobbot.models import RawJob, SourceResult
from jobbot.pipeline.normalize import parse_dt
from jobbot.sources.base import Source

SEARCH_URL = "https://www.foundit.in/middleware/jobsearch"
SITE = "https://www.foundit.in"


def _first(d: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        cur: Any = d
        for part in key.split("."):
            cur = cur.get(part) if isinstance(cur, dict) else None
            if cur is None:
                break
        if cur not in (None, "", []):
            return cur
    return None


def _job_list(payload: Any) -> list[dict[str, Any]] | None:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return None
    for key in (
        "jobSearchResponse.data",
        "jobSearchResponse.jobs",
        "data.jobs",
        "jobDetails",
        "jobs",
        "data",
    ):
        found = _first(payload, key)
        if isinstance(found, list):
            return found
    return None


def _location(item: dict[str, Any]) -> str:
    locs = _first(item, "locations", "location", "jobLocation")
    if isinstance(locs, list):
        names = [
            (x.get("city") or x.get("name") or x.get("location")) if isinstance(x, dict) else str(x)
            for x in locs
        ]
        return ", ".join(n for n in names if n)
    return str(locs or "")


def _experience(item: dict[str, Any]) -> str | None:
    lo = _first(item, "minimumExperience.years", "minExperience", "experienceMin")
    hi = _first(item, "maximumExperience.years", "maxExperience", "experienceMax")
    if lo is not None:
        return f"{lo}-{hi} years" if hi is not None else f"{lo}+ years"
    exp = _first(item, "experienceRange", "experience")
    return str(exp) if exp else None


def parse_search(payload: Any) -> list[RawJob]:
    items = _job_list(payload)
    if items is None:
        raise ValueError("foundit: unrecognised response shape (no job list found)")
    jobs: list[RawJob] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        title = _first(item, "title", "jobTitle", "designation")
        job_id = _first(item, "jobId", "id")
        path = _first(item, "seoJdUrl", "jdUrl", "jobUrl", "url")
        if not title or not (path or job_id):
            continue
        url = (
            path if isinstance(path, str) and path.startswith("http") else f"{SITE}{path or f'/job/{job_id}'}"
        )
        apply = _first(item, "redirectUrl", "applyUrl", "externalApplyUrl")
        skills = _first(item, "skills", "skillDetails", "keySkills")
        if isinstance(skills, list):
            skills = ", ".join(s.get("name", "") if isinstance(s, dict) else str(s) for s in skills)
        description = _first(item, "jobDescription", "description", "descriptionText", "summary") or ""
        if skills:
            description = f"{description}\n\nKey skills: {skills}".strip()
        jobs.append(
            RawJob(
                source="foundit",
                source_job_id=str(job_id) if job_id else None,
                title=str(title),
                company=str(_first(item, "companyName", "company.name", "company") or "Unknown"),
                location=_location(item),
                url=url,
                apply_url=apply if isinstance(apply, str) and apply.startswith("http") else None,
                description=str(description),
                posted_at=parse_dt(_first(item, "postedAt", "postedDate", "createdAt", "updatedAt")),
                experience_text=_experience(item),
            )
        )
    return jobs


class FounditSource(Source):
    name = "foundit"

    def __init__(self, client: httpx.Client, queries: list[str], conf: dict[str, Any]):
        self.client = client
        self.queries = queries
        self.limit = int(conf.get("results_wanted", 30))

    def fetch(self) -> SourceResult:
        result = SourceResult(source=self.name)
        for query in self.queries:
            result.calls += 1
            resp = get_json(
                self.client,
                SEARCH_URL,
                params={"start": 0, "limit": self.limit, "query": query, "sort": 1, "queryDerived": "true"},
                headers={
                    "User-Agent": BROWSER_UA,
                    "Accept": "application/json",
                    "Referer": f"{SITE}/srp/results?query={quote_plus(query)}",
                },
            )
            result.jobs.extend(parse_search(resp.json()))
        if not result.jobs:
            result.status = "empty"
        return result
