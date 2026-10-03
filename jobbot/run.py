"""One scan: fetch -> normalize -> dedupe -> filter -> store -> score -> tailor -> balances -> summary."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import httpx

from jobbot import balances
from jobbot.ats.keywords import extract_keywords
from jobbot.ats.score import JDKeywords
from jobbot.ats.skills import canonical, profile_vocabulary
from jobbot.config import Settings
from jobbot.llm.base import BudgetExceeded, LLMError, LLMProvider, QuotaExhausted
from jobbot.llm.ledger import Ledger
from jobbot.models import ApiUsage, Job, SourceResult
from jobbot.pipeline.filters import Filters, prerank
from jobbot.pipeline.normalize import merge, normalize
from jobbot.scoring import score_jobs
from jobbot.sources.base import Source, run_sources
from jobbot.store.base import resume_file_name
from jobbot.tailor.compile import find_engine
from jobbot.tailor.cover_letter import write_cover_letter
from jobbot.tailor.generate import pdf_text, tailor_job
from jobbot.tailor.own_resume import load_own, tailor_own_resume
from jobbot.tailor.recompile import process_edits

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


def profile_snapshot(profile: dict) -> dict:
    """What the dashboard's Skills tab needs to know about you (no contact details)."""
    return {
        "headline": profile.get("headline"),
        "years_experience": profile.get("years_experience"),
        "skills": sorted({canonical(t) for t in profile_vocabulary(profile)}, key=str.lower),
        "categories": profile.get("skills") or {},
    }


def _save_profile_snapshot(store, profile: dict, summary: dict) -> None:
    try:
        store.save_profile_snapshot(profile_snapshot(profile))
    except Exception as exc:  # noqa: BLE001 - informational only
        summary["errors"].append(f"profile snapshot: {exc!r}"[:300])


def _cover_letter(job: Job, profile: dict, outcome, ledger: Ledger, models: list[str], summary: dict) -> dict:
    """{"cover_letter": text, "fixes": [...]} for the record, or {} when the call fails (never blocks a resume)."""
    try:
        resume_text = pdf_text(outcome.pdf) if outcome.pdf else outcome.tex
        gaps = outcome.ats.missing_gaps if outcome.ats else []
        letter, removed = write_cover_letter(job, profile, resume_text, ledger, models, gaps)
    except (QuotaExhausted, BudgetExceeded, LLMError) as exc:
        summary["errors"].append(f"cover letter {job.id}: {exc}"[:300])
        return {}
    return {"cover_letter": letter or None, "fixes": outcome.fixes + removed}


def round_options(settings: Settings, known_skills: list[str] | None) -> dict:
    """The keyword arguments both tailoring modes take: ATS bar, preferences and which rounds run."""
    cfg = settings.search
    return {
        "target": cfg.ats.target,
        "minimum": cfg.ats.minimum,
        "known_skills": known_skills,
        "preferences": cfg.preferences,
        "reviewers": cfg.resume.reviewers,
        "fix_rounds": cfg.resume.fix_rounds,
    }


def tailor_jobs(
    settings: Settings,
    store,
    ledger: Ledger,
    provider: LLMProvider,
    jobs: list[Job],
    summary: dict,
    compile_pdf: bool = True,
) -> None:
    """Tailor each job (with ATS scoring and revision rounds), save the result, and note it in `summary`."""
    cfg = settings.search
    profile = settings.profile
    score_models, tailor_models = _models(settings, provider)
    engine = find_engine() if compile_pdf else None
    if compile_pdf and engine is None:
        summary["errors"].append("no LaTeX engine found (install tectonic or pdflatex); saved .tex only")
    known = store.known_skills()
    own = load_own(engine, summary["errors"])
    rounds = round_options(settings, known)
    summary.setdefault("ats", [])
    for job in jobs:
        jd = JDKeywords.model_validate(job.jd_keywords) if job.jd_keywords else None
        try:
            if jd is None or not (jd.required or jd.preferred):
                jd = extract_keywords(job, ledger, score_models)
                store.update_job(job.id, {"jd_keywords": jd.model_dump()})
            if own is not None:
                outcome = tailor_own_resume(job, profile, own, ledger, tailor_models, jd=jd, **rounds)
            else:
                outcome = tailor_job(job, profile, ledger, tailor_models, engine, jd=jd, **rounds)
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
        if cfg.cover_letter.enabled:
            record |= _cover_letter(job, profile, outcome, ledger, score_models, summary)
        name = resume_file_name(profile, job.company, job.title)
        store.save_tailoring(job.id, record, outcome.tex.encode(), outcome.pdf, name=name)
        store.update_job(
            job.id, {"status": "tailored", "ats_score": outcome.ats.score if outcome.ats else None}
        )
        summary["tailored"] = summary.get("tailored", 0) + 1
        if outcome.ats:
            summary["ats"].append(
                {
                    "job_id": job.id,
                    "title": job.title,
                    "company": job.company,
                    "score": outcome.ats.score,
                    "max_achievable": outcome.ats.max_achievable,
                    "rounds": outcome.ats_rounds,
                    "reviews": [r["title"] for r in outcome.rounds if r["review"]],
                    "gaps": outcome.ats.missing_gaps,
                }
            )


def tailor_queued(
    settings: Settings,
    store,
    provider: LLMProvider,
    client: httpx.Client,
    job_ids: list[str] | None = None,
    limit: int = 3,
) -> dict:
    """Tailor now: the given jobs, or every job queued from the dashboard/extension."""
    now = datetime.now(UTC)
    run_id = store.start_run("tailor-now")
    ledger = Ledger(provider, settings.pricing, store, now)
    summary: dict = {
        "run_id": run_id,
        "started_at": now.isoformat(),
        "sources": [],
        "tailored": 0,
        "errors": [],
    }
    status = "ok"
    try:
        if job_ids:
            jobs = [j for j in (store.get_job(i) for i in job_ids) if j is not None]
            missing = set(job_ids) - {j.id for j in jobs}
            if missing:
                summary["errors"].append(f"unknown job ids: {sorted(missing)}")
        else:
            jobs = store.tailor_candidates(limit, min_score=101)  # queued jobs only
        tailor_jobs(settings, store, ledger, provider, jobs, summary)
    except Exception as exc:
        status = "error"
        summary["errors"].append(repr(exc)[:500])
        raise
    finally:
        _save_profile_snapshot(store, settings.profile, summary)
        store.record_llm_usage(run_id, ledger.rows)
        summary["llm"] = ledger.totals()
        try:
            snaps = balances.collect(settings, store, client, [])
            store.record_balances(run_id, snaps)
            summary["balances"] = [s.model_dump() | {"low": s.low} for s in snaps]
        except Exception as exc:  # noqa: BLE001
            summary["errors"].append(f"balances: {exc!r}"[:300])
        summary["finished_at"] = datetime.now(UTC).isoformat()
        store.finish_run(run_id, status, summary)
    return summary


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
            "The master profile is still the example. Fill in profile/master_profile.yaml and remove "
            "`example: true`."
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
        kept, dropped = Filters(cfg).apply(merged, now)
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
            scores = score_jobs(pending, profile, cfg, ledger, score_models, store.known_skills())
            for job_id, s in scores.items():
                store.update_job(
                    job_id,
                    {
                        "llm_score": s.score,
                        "score_reason": s.reason,
                        "missing_keywords": s.missing_keywords,
                        "track": s.track,
                        "jd_keywords": s.jd_keywords(),
                        "verdict": s.verdict,
                        "legitimacy": s.legitimacy,
                        "legitimacy_signals": s.signals,
                        "hard_stops": s.hard_stops,
                        "fit": s.breakdown,
                    },
                )
            summary["scored"] = len(scores)
            summary["score_pending"] = len(pending) - len(scores)

        if ledger and opts.tailor:
            limit = cfg.limits.tailor_per_run if opts.max_tailor is None else opts.max_tailor
            jobs = store.tailor_candidates(limit, cfg.limits.min_score)
            tailor_jobs(settings, store, ledger, provider, jobs, summary, compile_pdf=opts.compile_pdf)
        if opts.compile_pdf:
            # resumes edited on the dashboard that Tailor now could not start (no AI calls)
            summary["edits"] = process_edits(settings, store, find_engine())
    except Exception as exc:
        status = "error"
        summary["errors"].append(repr(exc)[:500])
        raise
    finally:
        _save_profile_snapshot(store, profile, summary)
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
