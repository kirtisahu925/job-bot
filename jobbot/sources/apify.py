"""Runs an Apify actor (Wellfound by default) and maps its dataset items to RawJobs.

Cost control: every run is started with maxTotalChargeUsd, and the run's cost is recorded from the
run object (usageTotalUsd) so the Consumption page shows real money spent.
"""

from __future__ import annotations

import json
import time
from typing import Any

import httpx

from jobbot.http import get_json, post_json
from jobbot.models import RawJob, SourceResult
from jobbot.pipeline.normalize import parse_dt
from jobbot.sources.base import Source

API = "https://api.apify.com/v2"
TERMINAL = {"SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"}


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


def items_to_jobs(site: str, items: list[dict[str, Any]]) -> list[RawJob]:
    jobs: list[RawJob] = []
    for item in items:
        title = _first(item, "title", "jobTitle", "name", "position")
        url = _first(item, "url", "jobUrl", "link", "job_url")
        if not title or not url:
            continue
        loc = _first(item, "location", "locations", "locationNames")
        if isinstance(loc, list):
            loc = ", ".join(x if isinstance(x, str) else str(x.get("name", "")) for x in loc)
        remote = _first(item, "remote", "isRemote", "remoteOk")
        jobs.append(
            RawJob(
                source=site,
                source_job_id=str(_first(item, "id", "jobId") or "") or None,
                title=str(title),
                company=str(
                    _first(item, "companyName", "company.name", "company", "startup.name") or "Unknown"
                ),
                location=str(loc or ""),
                remote=bool(remote) if isinstance(remote, bool) else "remote" in str(loc or "").lower(),
                url=str(url),
                apply_url=_first(item, "applyUrl", "apply_url"),
                description=str(
                    _first(item, "description", "descriptionText", "descriptionHtml", "jobDescription") or ""
                ),
                posted_at=parse_dt(_first(item, "postedAt", "datePosted", "publishedAt", "createdAt")),
                experience_text=_first(item, "experience", "yearsExperience"),
                remote_region=_first(item, "remoteRegion", "locationRestrictions"),
            )
        )
    return jobs


class ApifyRunError(RuntimeError):
    def __init__(self, message: str, cost_usd: float):
        super().__init__(message)
        self.cost_usd = cost_usd


def render_input(template: dict[str, Any], query: str) -> dict[str, Any]:
    return json.loads(json.dumps(template).replace("{query}", query.replace('"', "")))


class ApifySource(Source):
    def __init__(
        self,
        site: str,
        client: httpx.Client,
        token: str | None,
        conf: dict[str, Any],
        queries: list[str],
        poll_s: int = 60,
    ):
        self.name = site
        self.client = client
        self.token = token
        self.conf = conf
        self.queries = queries
        self.poll_s = poll_s

    def _run_actor(self, actor_input: dict[str, Any]) -> tuple[list[dict[str, Any]], float]:
        actor = self.conf["actor_id"]
        params = {
            "token": self.token,
            "maxTotalChargeUsd": self.conf.get("max_charge_usd", 0.10),
            "timeout": self.conf.get("timeout_s", 300),
        }
        run = post_json(self.client, f"{API}/acts/{actor}/runs", params=params, json=actor_input).json()[
            "data"
        ]
        deadline = time.monotonic() + float(self.conf.get("timeout_s", 300)) + 60
        while run.get("status") not in TERMINAL and time.monotonic() < deadline:
            run = get_json(
                self.client,
                f"{API}/actor-runs/{run['id']}",
                params={"token": self.token, "waitForFinish": self.poll_s},
                timeout=self.poll_s + 30,
            ).json()["data"]
        cost = float(run.get("usageTotalUsd") or 0.0)
        if run.get("status") != "SUCCEEDED":
            raise ApifyRunError(f"apify run {run.get('id')} ended {run.get('status')}", cost)
        items = get_json(
            self.client,
            f"{API}/datasets/{run['defaultDatasetId']}/items",
            params={"token": self.token, "clean": "true", "format": "json"},
        ).json()
        return items, cost

    def fetch(self) -> SourceResult:
        if not self.token:
            return SourceResult(source=self.name, status="skipped", error="APIFY_TOKEN not set")
        if not self.conf.get("actor_id"):
            return SourceResult(source=self.name, status="skipped", error="no actor_id configured")
        result = SourceResult(source=self.name)
        template = self.conf.get("input") or {"keyword": "{query}"}
        errors: list[str] = []
        for query in self.queries:
            result.calls += 1
            try:
                items, cost = self._run_actor(render_input(template, query))
            except ApifyRunError as exc:  # the run still cost money; keep the charge
                result.cost_usd += exc.cost_usd
                errors.append(str(exc))
                continue
            result.cost_usd += cost
            result.jobs.extend(items_to_jobs(self.name, items))
        if errors and len(errors) == len(self.queries):
            result.status, result.error = "error", "; ".join(errors)
        elif not result.jobs:
            result.status = "empty"
        elif errors:
            result.error = "; ".join(errors)
        return result


def account_limits(client: httpx.Client, token: str) -> dict[str, Any]:
    """GET /users/me/limits: current.monthlyUsageUsd vs limits.maxMonthlyUsageUsd."""
    return get_json(client, f"{API}/users/me/limits", params={"token": token}).json()["data"]
