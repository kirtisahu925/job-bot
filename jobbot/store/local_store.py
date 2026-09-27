"""SQLite store for local development and --dry-run. Same behaviour as the Supabase store."""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from jobbot.models import ApiUsage, BalanceSnapshot, Job, JobLink, LLMUsage
from jobbot.store.base import JOB_COLUMNS, job_row

SCHEMA = """
create table if not exists runs (id text primary key, trigger text, status text, summary text,
  started_at text, finished_at text);
create table if not exists jobs (id text primary key, fingerprint text unique, title text, company text,
  location text, city text, remote integer, apply_url text, description text, salary_min real, salary_max real,
  currency text, posted_at text, track text, min_years integer, prefilter_score real, llm_score integer,
  score_reason text, missing_keywords text, status text, captured_by text, remote_region text,
  first_run_id text, created_at text, updated_at text);
create table if not exists job_links (id text primary key, job_id text, source text, url text,
  url_key text unique, source_job_id text);
create table if not exists tailorings (id text primary key, job_id text, record text, tex_path text,
  pdf_path text, created_at text);
create table if not exists llm_usage (id text primary key, run_id text, ts text, provider text, model text,
  purpose text, input_tokens integer, output_tokens integer, thinking_tokens integer, cached_tokens integer,
  latency_ms integer, status text, cost_usd real, shadow_cost_usd real, error text, job_id text);
create table if not exists api_usage (id text primary key, run_id text, ts text, source text, calls integer,
  results integer, status text, cost_usd real, remaining integer, error text);
create table if not exists balance_snapshots (id text primary key, run_id text, checked_at text, provider text,
  kind text, unit text, used real, "limit" real, remaining real, period text, method text, note text);
create table if not exists credit_topups (id text primary key, provider text, amount_usd real,
  purchased_at text, note text);
"""


def _now() -> str:
    return datetime.now(UTC).isoformat()


class LocalStore:
    def __init__(self, path: Path | str = ":memory:", out_dir: Path | None = None):
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path))
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        self.out_dir = out_dir

    # runs -----------------------------------------------------------------
    def start_run(self, trigger: str) -> str:
        run_id = str(uuid.uuid4())
        self.db.execute(
            "insert into runs values (?,?,?,?,?,?)", (run_id, trigger, "running", None, _now(), None)
        )
        self.db.commit()
        return run_id

    def finish_run(self, run_id: str, status: str, summary: dict[str, Any]) -> None:
        self.db.execute(
            "update runs set status=?, summary=?, finished_at=? where id=?",
            (status, json.dumps(summary, default=str), _now(), run_id),
        )
        self.db.commit()

    # jobs -----------------------------------------------------------------
    def _row_to_job(self, row: sqlite3.Row) -> Job:
        data = dict(row)
        data["remote"] = bool(data["remote"])
        data["missing_keywords"] = json.loads(data["missing_keywords"] or "[]")
        links = self.db.execute("select * from job_links where job_id=?", (data["id"],)).fetchall()
        data["links"] = [
            JobLink(**{k: row[k] for k in ("source", "url", "url_key", "source_job_id")}) for row in links
        ]
        return Job.model_validate({k: v for k, v in data.items() if k in Job.model_fields})

    def get_job(self, job_id: str) -> Job | None:
        row = self.db.execute("select * from jobs where id=?", (job_id,)).fetchone()
        return self._row_to_job(row) if row else None

    def _add_links(self, job_id: str, links: list[JobLink]) -> None:
        for link in links:
            self.db.execute(
                "insert or ignore into job_links values (?,?,?,?,?,?)",
                (str(uuid.uuid4()), job_id, link.source, link.url, link.url_key, link.source_job_id),
            )

    def upsert_jobs(self, run_id: str, jobs: list[Job]) -> tuple[list[Job], int]:
        new: list[Job] = []
        known = 0
        for job in jobs:
            row = self.db.execute(
                "select id, description from jobs where fingerprint=?", (job.fingerprint,)
            ).fetchone()
            if row is None:
                keys = [link.url_key for link in job.links]
                marks = ",".join("?" * len(keys))
                hit = self.db.execute(
                    f"select job_id from job_links where url_key in ({marks})", keys
                ).fetchone()
                if hit:
                    row = self.db.execute(
                        "select id, description from jobs where id=?", (hit["job_id"],)
                    ).fetchone()
            if row is not None:
                known += 1
                self._add_links(row["id"], job.links)
                if len(job.description) > len(row["description"] or ""):
                    self.db.execute(
                        "update jobs set description=?, updated_at=? where id=?",
                        (job.description, _now(), row["id"]),
                    )
                continue
            job.id = str(uuid.uuid4())
            values = job_row(job)
            values["missing_keywords"] = json.dumps(values["missing_keywords"])
            values["remote"] = int(values["remote"])
            cols = ["id", *JOB_COLUMNS, "first_run_id", "created_at", "updated_at"]
            self.db.execute(
                f"insert into jobs ({','.join(cols)}) values ({','.join('?' * len(cols))})",
                [job.id, *[values[c] for c in JOB_COLUMNS], run_id, _now(), _now()],
            )
            self._add_links(job.id, job.links)
            new.append(job)
        self.db.commit()
        return new, known

    def unscored_jobs(self, limit: int, since: datetime) -> list[Job]:
        rows = self.db.execute(
            "select * from jobs where llm_score is null and status='new' and created_at>=? "
            "order by prefilter_score desc limit ?",
            (since.isoformat(), limit),
        ).fetchall()
        return [self._row_to_job(r) for r in rows]

    def update_job(self, job_id: str, fields: dict[str, Any]) -> None:
        fields = dict(fields)
        if "missing_keywords" in fields:
            fields["missing_keywords"] = json.dumps(fields["missing_keywords"])
        fields["updated_at"] = _now()
        sets = ",".join(f"{k}=?" for k in fields)
        self.db.execute(f"update jobs set {sets} where id=?", [*fields.values(), job_id])
        self.db.commit()

    def tailor_candidates(self, limit: int, min_score: int) -> list[Job]:
        queued = self.db.execute(
            "select * from jobs where status='tailor_queued' order by updated_at asc limit ?", (limit,)
        ).fetchall()
        rest = limit - len(queued)
        best = []
        if rest > 0:
            best = self.db.execute(
                "select * from jobs where status='new' and llm_score>=? and id not in (select job_id from tailorings) "
                "order by llm_score desc limit ?",
                (min_score, rest),
            ).fetchall()
        return [self._row_to_job(r) for r in [*queued, *best]]

    def save_tailoring(
        self, job_id: str, record: dict[str, Any], tex: bytes | None, pdf: bytes | None
    ) -> dict:
        tex_path = pdf_path = None
        if self.out_dir is not None:
            folder = self.out_dir / job_id
            folder.mkdir(parents=True, exist_ok=True)
            if tex is not None:
                (folder / "resume.tex").write_bytes(tex)
                tex_path = str(folder / "resume.tex")
            if pdf is not None:
                (folder / "resume.pdf").write_bytes(pdf)
                pdf_path = str(folder / "resume.pdf")
        self.db.execute(
            "insert into tailorings values (?,?,?,?,?,?)",
            (str(uuid.uuid4()), job_id, json.dumps(record, default=str), tex_path, pdf_path, _now()),
        )
        self.db.commit()
        return {"tex_path": tex_path, "pdf_path": pdf_path}

    # usage ----------------------------------------------------------------
    def record_api_usage(self, run_id: str, rows: list[ApiUsage]) -> None:
        for r in rows:
            self.db.execute(
                "insert into api_usage values (?,?,?,?,?,?,?,?,?,?)",
                (
                    str(uuid.uuid4()),
                    run_id,
                    _now(),
                    r.source,
                    r.calls,
                    r.results,
                    r.status,
                    r.cost_usd,
                    r.remaining,
                    r.error,
                ),
            )
        self.db.commit()

    def record_llm_usage(self, run_id: str, rows: list[LLMUsage]) -> None:
        for r in rows:
            self.db.execute(
                "insert into llm_usage values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    str(uuid.uuid4()),
                    run_id,
                    _now(),
                    r.provider,
                    r.model,
                    r.purpose,
                    r.input_tokens,
                    r.output_tokens,
                    r.thinking_tokens,
                    r.cached_tokens,
                    r.latency_ms,
                    r.status,
                    r.cost_usd,
                    r.shadow_cost_usd,
                    r.error,
                    r.job_id,
                ),
            )
        self.db.commit()

    def record_balances(self, run_id: str, rows: list[BalanceSnapshot]) -> None:
        for r in rows:
            self.db.execute(
                "insert into balance_snapshots values (?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    str(uuid.uuid4()),
                    run_id,
                    _now(),
                    r.provider,
                    r.kind,
                    r.unit,
                    r.used,
                    r.limit,
                    r.remaining,
                    r.period,
                    r.method,
                    r.note,
                ),
            )
        self.db.commit()

    def llm_requests_since(self, since: datetime) -> dict[str, int]:
        rows = self.db.execute(
            "select model, count(*) n from llm_usage where ts>=? and status!='skipped_cap' group by model",
            (since.isoformat(),),
        ).fetchall()
        return {r["model"]: r["n"] for r in rows}

    def llm_cost_since(self, provider: str, since: datetime) -> float:
        row = self.db.execute(
            "select coalesce(sum(cost_usd),0) c from llm_usage where provider=? and ts>=?",
            (provider, since.isoformat()),
        ).fetchone()
        return float(row["c"])

    def api_calls_since(self, source: str, since: datetime) -> int:
        row = self.db.execute(
            "select coalesce(sum(calls),0) c from api_usage where source=? and ts>=?",
            (source, since.isoformat()),
        ).fetchone()
        return int(row["c"])

    def api_cost_since(self, source: str, since: datetime) -> float:
        row = self.db.execute(
            "select coalesce(sum(cost_usd),0) c from api_usage where source=? and ts>=?",
            (source, since.isoformat()),
        ).fetchone()
        return float(row["c"])

    def topups(self, provider: str) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "select * from credit_topups where provider=? order by purchased_at", (provider,)
        )
        return [dict(r) for r in rows.fetchall()]

    def add_topup(self, provider: str, amount_usd: float, purchased_at: datetime, note: str = "") -> None:
        self.db.execute(
            "insert into credit_topups values (?,?,?,?,?)",
            (str(uuid.uuid4()), provider, amount_usd, purchased_at.isoformat(), note),
        )
        self.db.commit()
