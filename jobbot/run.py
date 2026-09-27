"""One scan: fetch -> normalize -> dedupe -> filter -> store -> score -> tailor -> balances -> summary."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import httpx

from jobbot import balances
from jobbot.config import Settings
from jobbot.llm.base import BudgetExceeded, LLMError, LLMProvider, QuotaExhausted
from jobbot.llm.ledger import Ledger
from jobbot.models import ApiUsage, SourceResult
from jobbot.pipeline.filters import Filters, prerank
from jobbot.pipeline.normalize import merge, normalize
from jobbot.scoring import score_jobs
from jobbot.sources.base import Source, run_sources
from jobbot.tailor.compile import find_engine
from jobbot.tailor.generate import tailor_job

log = logging.getLogger(__name__)


class ExampleProfileError(RuntimeError):
    pass


@dataclass
class RunOptions:
    trigger: str = "manual"
    score: bool = True
    tailor: bool = True
    max_tailor: int | None = None
    compile_pdf: bool = True
    allow_example_profile: bool = False


def _models(settings: Settings, provider: LLMProvider) -> tuple[list[str], list[str]]:
    llm = settings.pricing.llm
    if provider.name == "anthropic":
        return [llm.anthropic_score_model], [llm.anthropic_tailor_model]
    return llm.score_models, llm.tailor_models


def run(
    settings: Settings,
    store,
    provider: LLMProvider | None,
    sources: list[Source],
    client: httpx.Client,
    opts: RunOptions | None = None,
) -> dict:
    opts = opts or RunOptions()
    profile = settings.profile
    if (
        profile.get("example")
        and not opts.allow_example_profile
        and provider is not None
        and provider.name != "fake"
    ):
        raise ExampleProfileError(
            "The master profile is still the example. Fill in profile/master_profile.yaml (or the "
            "MASTER_PROFILE_YAML secret) and remove `example: true`."
        )
    cfg = settings.search
    now = datetime.now(UTC)
    run_id = store.start_run(opts.trigger)
    ledger = Ledger(provider, settings.pricing, store, now) if provider is not None else None
    summary: dict = {
        "run_id": run_id,
        "started_at": now.isoformat(),
        "sources": [],
        "tailored": 0,
        "scored": 0,
        "errors": [],
    }
    results: list[SourceResult] = []
    status = "ok"
    try:
        results = run_sources(sources)
        summary["sources"] = [
            {
                "source": r.source,
                "status": r.status,
                "calls": r.calls,
                "results": r.results,
                "cost_usd": round(r.cost_usd, 4),
                "error": r.error,
            }
            for r in results
        ]
        store.record_api_usage(
            run_id,
            [
                ApiUsage(
                    source=r.source,
                    calls=r.calls,
                    results=r.results,
                    status=r.status,
                    cost_usd=r.cost_usd,
                    remaining=r.remaining,
                    error=r.error,
                )
                for r in results
            ],
        )
        raw = [job for r in results for job in r.jobs]
        merged = merge([normalize(job, cfg.locations) for job in raw])
        kept, dropped = Filters(cfg).apply(merged)
        ranked = prerank(kept, profile, now)
        new_jobs, known = store.upsert_jobs(run_id, ranked)
        summary.update(
            fetched=len(raw),
            unique=len(merged),
            kept=len(kept),
            dropped=dict(dropped),
            new_jobs=len(new_jobs),
            already_known=known,
        )

        if ledger and opts.score:
            score_models, _ = _models(settings, provider)
            pending = store.unscored_jobs(cfg.limits.score_top_k, now - timedelta(days=3))
            scores = score_jobs(pending, profile, cfg, ledger, score_models)
            for job_id, s in scores.items():
                store.update_job(
                    job_id,
                    {
                        "llm_score": s.score,
                        "score_reason": s.reason,
                        "missing_keywords": s.missing_keywords,
                        "track": s.track,
                    },
                )
            summary["scored"] = len(scores)
            summary["score_pending"] = len(pending) - len(scores)

        if ledger and opts.tailor:
            _, tailor_models = _models(settings, provider)
            engine = find_engine() if opts.compile_pdf else None
            if opts.compile_pdf and engine is None:
                summary["errors"].append(
                    "no LaTeX engine found (install tectonic or pdflatex); saved .tex only"
                )
            limit = cfg.limits.tailor_per_run if opts.max_tailor is None else opts.max_tailor
            for job in store.tailor_candidates(limit, cfg.limits.min_score):
                try:
                    outcome = tailor_job(
                        job, profile, ledger, tailor_models, engine, cfg.limits.max_revisions
                    )
                except (QuotaExhausted, BudgetExceeded) as exc:
                    summary["tailor_stopped"] = str(exc)[:300]
                    break
                except LLMError as exc:
                    summary["errors"].append(f"tailor {job.id}: {exc}"[:300])
                    continue
                model = next(
                    (r.model for r in reversed(ledger.rows) if r.job_id == job.id and r.status == "ok"), None
                )
                record = outcome.record() | {"provider": provider.name, "model": model}
                store.save_tailoring(job.id, record, outcome.tex.encode(), outcome.pdf)
                store.update_job(job.id, {"status": "tailored"})
                summary["tailored"] += 1
    except Exception as exc:
        status = "error"
        summary["errors"].append(repr(exc)[:500])
        raise
    finally:
        if ledger:
            store.record_llm_usage(run_id, ledger.rows)
            summary["llm"] = ledger.totals()
        try:
            snaps = balances.collect(settings, store, client, results)
            store.record_balances(run_id, snaps)
            summary["balances"] = [s.model_dump() | {"low": s.low} for s in snaps]
        except Exception as exc:  # noqa: BLE001 - never lose the run record over a balance lookup
            summary["errors"].append(f"balances: {exc!r}"[:300])
        summary["finished_at"] = datetime.now(UTC).isoformat()
        store.finish_run(run_id, status, summary)
    return summary
