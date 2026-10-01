"""Supabase store over plain REST (PostgREST + Storage). Uses the service-role key, which bypasses RLS."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import httpx

from jobbot.models import ApiUsage, BalanceSnapshot, Job, JobLink, LLMUsage
from jobbot.store.base import job_row

BUCKET = "resumes"
CHUNK = 40


def _in(values: list[str]) -> str:
    quoted = ",".join('"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"' for v in values)
    return f"in.({quoted})"


class SupabaseStore:
    def __init__(self, url: str, service_key: str, client: httpx.Client | None = None):
        self.base = url.rstrip("/")
        self.client = client or httpx.Client(timeout=60)
        self.headers = {"apikey": service_key}
        if service_key.startswith("eyJ"):  # legacy service_role JWT; new sb_secret_ keys go in apikey only
            self.headers["Authorization"] = f"Bearer {service_key}"

    # low-level ------------------------------------------------------------
    def _get(self, table: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        resp = self.client.get(f"{self.base}/rest/v1/{table}", params=params, headers=self.headers)
        resp.raise_for_status()
        return resp.json()

    def _post(
        self,
        table: str,
        rows: list[dict] | dict,
        *,
        returning: bool = False,
        on_conflict: str | None = None,
        ignore_duplicates: bool = False,
        merge: bool = False,
    ) -> list[dict[str, Any]]:
        prefer = ["return=representation" if returning else "return=minimal"]
        if ignore_duplicates:
            prefer.append("resolution=ignore-duplicates")
        if merge:
            prefer.append("resolution=merge-duplicates")
        params = {"on_conflict": on_conflict} if on_conflict else None
        resp = self.client.post(
            f"{self.base}/rest/v1/{table}",
            json=rows,
            params=params,
            headers={**self.headers, "Prefer": ",".join(prefer)},
        )
        resp.raise_for_status()
        return resp.json() if returning else []

    def _patch(self, table: str, match: dict[str, str], fields: dict[str, Any]) -> None:
        resp = self.client.patch(
            f"{self.base}/rest/v1/{table}",
            params=match,
            json=fields,
            headers={**self.headers, "Prefer": "return=minimal"},
        )
        resp.raise_for_status()

    # runs -----------------------------------------------------------------
    def start_run(self, trigger: str) -> str:
        return self._post("runs", {"trigger": trigger, "status": "running"}, returning=True)[0]["id"]

    def finish_run(self, run_id: str, status: str, summary: dict[str, Any]) -> None:
        self._patch(
            "runs",
            {"id": f"eq.{run_id}"},
            {"status": status, "summary": summary, "finished_at": datetime.now(UTC).isoformat()}
            | _run_counts(summary),
        )

    # jobs -----------------------------------------------------------------
    def upsert_jobs(self, run_id: str, jobs: list[Job]) -> tuple[list[Job], int]:
        if not jobs:
            return [], 0
        fps = [j.fingerprint for j in jobs]
        keys = sorted({link.url_key for j in jobs for link in j.links})
        by_fp: dict[str, dict] = {}
        for i in range(0, len(fps), CHUNK):
            for row in self._get(
                "jobs", {"select": "id,fingerprint,description", "fingerprint": _in(fps[i : i + CHUNK])}
            ):
                by_fp[row["fingerprint"]] = row
        key_to_job: dict[str, str] = {}
        for i in range(0, len(keys), CHUNK):
            for row in self._get(
                "job_links", {"select": "job_id,url_key", "url_key": _in(keys[i : i + CHUNK])}
            ):
                key_to_job[row["url_key"]] = row["job_id"]

        new_jobs: list[Job] = []
        links: list[dict[str, Any]] = []
        known = 0
        for job in jobs:
            existing = by_fp.get(job.fingerprint)
            job_id = (
                existing["id"]
                if existing
                else next(
                    (key_to_job[link.url_key] for link in job.links if link.url_key in key_to_job), None
                )
            )
            if job_id is None:
                new_jobs.append(job)
                continue
            known += 1
            job.id = job_id
            links.extend(_link_row(job_id, link) for link in job.links if link.url_key not in key_to_job)
            if existing and len(job.description) > len(existing.get("description") or ""):
                self._patch("jobs", {"id": f"eq.{job_id}"}, {"description": job.description})

        if new_jobs:
            rows = [job_row(j) | {"first_run_id": run_id} for j in new_jobs]
            inserted = self._post(
                "jobs", rows, returning=True, on_conflict="fingerprint", ignore_duplicates=True
            )
            ids = {r["fingerprint"]: r["id"] for r in inserted}
            for job in new_jobs:
                job.id = ids.get(job.fingerprint)
                if job.id:
                    links.extend(_link_row(job.id, link) for link in job.links)
            new_jobs = [j for j in new_jobs if j.id]
        if links:
            self._post("job_links", links, on_conflict="url_key", ignore_duplicates=True)
        return new_jobs, known

    def _jobs(self, params: dict[str, Any]) -> list[Job]:
        rows = self._get("jobs", {"select": "*,job_links(source,url,url_key,source_job_id)", **params})
        out = []
        for row in rows:
            row["links"] = [JobLink(**link) for link in row.pop("job_links", []) or []]
            # empty columns (a job saved from the extension has no prefilter score) take the model's defaults
            out.append(
                Job.model_validate({k: v for k, v in row.items() if k in Job.model_fields and v is not None})
            )
        return out

    def unscored_jobs(self, limit: int, since: datetime) -> list[Job]:
        return self._jobs(
            {
                "llm_score": "is.null",
                "status": "eq.new",
                "created_at": f"gte.{since.isoformat()}",
                "order": "prefilter_score.desc",
                "limit": limit,
            }
        )

    def update_job(self, job_id: str, fields: dict[str, Any]) -> None:
        self._patch("jobs", {"id": f"eq.{job_id}"}, fields)

    def tailor_candidates(self, limit: int, min_score: int) -> list[Job]:
        queued = self._jobs({"status": "eq.tailor_queued", "order": "updated_at.asc", "limit": limit})
        rest = limit - len(queued)
        best: list[Job] = []
        if rest > 0:
            best = self._jobs(
                {
                    "status": "eq.new",
                    "llm_score": f"gte.{min_score}",
                    "or": "(verdict.is.null,verdict.neq.skip)",  # never spend a resume on a do-not-apply job
                    "order": "llm_score.desc",
                    "limit": rest,
                }
            )
        return queued + best

    def _upload(self, path: str, content: bytes, content_type: str) -> str:
        resp = self.client.post(
            f"{self.base}/storage/v1/object/{BUCKET}/{path}",
            content=content,
            headers={**self.headers, "Content-Type": content_type, "x-upsert": "true"},
        )
        resp.raise_for_status()
        return path

    def save_tailoring(
        self, job_id: str, record: dict[str, Any], tex: bytes | None, pdf: bytes | None
    ) -> dict:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        tex_path = self._upload(f"{job_id}/{stamp}/resume.tex", tex, "text/plain") if tex else None
        pdf_path = self._upload(f"{job_id}/{stamp}/resume.pdf", pdf, "application/pdf") if pdf else None
        rows = self._post(
            "tailorings",
            {"job_id": job_id, **record, "tex_path": tex_path, "pdf_path": pdf_path},
            returning=True,
        )
        return {"id": rows[0]["id"] if rows else None, "tex_path": tex_path, "pdf_path": pdf_path}

    def get_tailoring(self, tailoring_id: str) -> dict[str, Any]:
        rows = self._get("tailorings", {"select": "*", "id": f"eq.{tailoring_id}", "limit": 1})
        return rows[0] if rows else {}

    # resumes edited by hand on the dashboard --------------------------------
    def resume_edits(self, ids: list[str] | None = None) -> list[dict[str, Any]]:
        """The given edits (queued or stuck compiling), or every queued one, oldest first."""
        params: dict[str, Any] = {
            "select": "id,job_id,base_tailoring_id,tex,status",
            "order": "created_at.asc",
        }
        if ids:
            params |= {"id": _in(ids), "status": "in.(queued,compiling)"}
        else:
            params |= {"status": "eq.queued", "limit": 10}
        return self._get("resume_edits", params)

    def update_edit(self, edit_id: str, fields: dict[str, Any]) -> None:
        self._patch(
            "resume_edits", {"id": f"eq.{edit_id}"}, {**fields, "updated_at": datetime.now(UTC).isoformat()}
        )

    # usage ----------------------------------------------------------------
    def record_api_usage(self, run_id: str, rows: list[ApiUsage]) -> None:
        if rows:
            self._post("api_usage", [r.model_dump() | {"run_id": run_id} for r in rows])

    def record_llm_usage(self, run_id: str, rows: list[LLMUsage]) -> None:
        if rows:
            self._post("llm_usage", [r.model_dump() | {"run_id": run_id} for r in rows])

    def record_balances(self, run_id: str, rows: list[BalanceSnapshot]) -> None:
        if rows:
            # `limit` is a PostgREST query keyword, so the column is limit_value
            payload = []
            for r in rows:
                data = r.model_dump()
                data["limit_value"] = data.pop("limit")
                payload.append(data | {"run_id": run_id})
            self._post("balance_snapshots", payload)

    def llm_requests_since(self, since: datetime) -> dict[str, int]:
        counts: dict[str, int] = {}
        rows = self._get(
            "llm_usage", {"select": "model", "ts": f"gte.{since.isoformat()}", "status": "neq.skipped_cap"}
        )
        for row in rows:
            counts[row["model"]] = counts.get(row["model"], 0) + 1
        return counts

    def llm_cost_since(self, provider: str, since: datetime) -> float:
        rows = self._get(
            "llm_usage",
            {"select": "cost_usd", "provider": f"eq.{provider}", "ts": f"gte.{since.isoformat()}"},
        )
        return float(sum(r["cost_usd"] or 0 for r in rows))

    def api_calls_since(self, source: str, since: datetime) -> int:
        rows = self._get(
            "api_usage", {"select": "calls", "source": f"eq.{source}", "ts": f"gte.{since.isoformat()}"}
        )
        return int(sum(r["calls"] or 0 for r in rows))

    def api_cost_since(self, source: str, since: datetime) -> float:
        rows = self._get(
            "api_usage", {"select": "cost_usd", "source": f"eq.{source}", "ts": f"gte.{since.isoformat()}"}
        )
        return float(sum(r["cost_usd"] or 0 for r in rows))

    def get_job(self, job_id: str) -> Job | None:
        found = self._jobs({"id": f"eq.{job_id}", "limit": 1})
        return found[0] if found else None

    def known_skills(self) -> list[str]:
        return [r["skill"] for r in self._get("skill_status", {"select": "skill", "status": "eq.known"})]

    def save_profile_snapshot(self, snapshot: dict[str, Any]) -> None:
        self._post(
            "profile_snapshot",
            {"id": 1, **snapshot, "updated_at": datetime.now(UTC).isoformat()},
            on_conflict="id",
            merge=True,
        )

    def user_settings(self) -> dict[str, Any]:
        """The dashboard's Preferences and Settings ({} before you save them, or before migration 0008)."""
        try:
            rows = self._get("user_settings", {"select": "preferences,settings", "id": "eq.1"})
        except httpx.HTTPStatusError:
            return {}
        return rows[0] if rows else {}

    def company_boards(self) -> list[dict[str, Any]]:
        """Career boards added on the dashboard's Companies page: [{"board": "greenhouse", "slug", "name"}]."""
        try:
            rows = self._get("companies", {"select": "name,board,board_slug", "board_slug": "not.is.null"})
        except httpx.HTTPStatusError:
            return []
        return [
            {"board": r["board"], "slug": r["board_slug"], "name": r["name"]} for r in rows if r.get("board")
        ]

    def topups(self, provider: str) -> list[dict[str, Any]]:
        return self._get(
            "credit_topups", {"select": "*", "provider": f"eq.{provider}", "order": "purchased_at.asc"}
        )


def _link_row(job_id: str, link: JobLink) -> dict[str, Any]:
    return {"job_id": job_id, **link.model_dump()}


def _run_counts(summary: dict[str, Any]) -> dict[str, Any]:
    keys = ("fetched", "new_jobs", "scored", "tailored")
    return {k: summary.get(k) for k in keys if k in summary}
