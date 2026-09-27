"""Command line: `python -m jobbot <command>`."""

from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime
from pathlib import Path

import typer

from jobbot.config import ROOT, load_settings
from jobbot.http import make_client
from jobbot.report import markdown

app = typer.Typer(add_completion=False, no_args_is_help=True, help="Scan jobs, score them, tailor resumes.")
log = logging.getLogger("jobbot")


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO, format="%(levelname)s %(name)s: %(message)s"
    )
    for noisy in ("httpx", "httpcore", "JobSpy", "google_genai"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def _store(kind: str, out_dir: Path, settings):
    if kind == "supabase":
        from jobbot.store.supabase_store import SupabaseStore

        s = settings.secrets
        if not (s.supabase_url and s.supabase_service_role_key):
            raise typer.BadParameter(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for --store supabase"
            )
        return SupabaseStore(s.supabase_url, s.supabase_service_role_key)
    from jobbot.store.local_store import LocalStore

    return LocalStore(out_dir / "jobbot.db" if kind == "local" else ":memory:", out_dir=out_dir)


def _provider(kind: str, settings):
    kind = kind or settings.pricing.llm.provider
    if kind == "none":
        return None
    if kind == "fake":
        from jobbot.llm.fake import FakeProvider

        return FakeProvider()
    if kind == "anthropic":
        from jobbot.llm.anthropic_client import AnthropicProvider

        if not settings.secrets.anthropic_api_key:
            raise typer.BadParameter("ANTHROPIC_API_KEY is not set")
        return AnthropicProvider(settings.secrets.anthropic_api_key)
    from jobbot.llm.gemini import GeminiProvider

    if not settings.secrets.gemini_api_key:
        raise typer.BadParameter("GEMINI_API_KEY is not set (or pass --llm fake / --llm none)")
    return GeminiProvider(settings.secrets.gemini_api_key)


def _sources(settings, client, store, only: list[str] | None, fixture: Path | None):
    from jobbot.llm.ledger import month_start
    from jobbot.sources.base import build_sources
    from jobbot.sources.fixture import FixtureSource

    if fixture is not None:
        return [FixtureSource(fixture)]
    now = datetime.now(UTC)
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return build_sources(
        settings,
        client,
        only=only,
        calls_this_month=lambda src: store.api_calls_since(src, month_start(now)),
        calls_today=lambda src: store.api_calls_since(src, day),
    )


@app.command()
def run(
    store: str = typer.Option("supabase", help="supabase | local (SQLite in --out) | memory"),
    llm: str = typer.Option("", help="gemini | anthropic | fake | none (default: config/pricing.yaml)"),
    sources: str = typer.Option("", help="comma-separated subset, e.g. linkedin,naukri"),
    fixture: Path = typer.Option(None, help="replay jobs from a JSON file instead of fetching"),
    max_tailor: int = typer.Option(None, help="override tailor_per_run"),
    no_compile: bool = typer.Option(False, help="skip LaTeX compilation"),
    out: Path = typer.Option(ROOT / "out", help="output folder for local store and PDFs"),
    trigger: str = typer.Option("manual", help="recorded on the run (schedule | manual)"),
    allow_example_profile: bool = typer.Option(False, help="run even if the profile is still the example"),
    verbose: bool = typer.Option(False, "-v"),
):
    """Full pipeline: fetch, filter, score, tailor, record usage and balances."""
    from jobbot.run import RunOptions
    from jobbot.run import run as run_pipeline

    _setup_logging(verbose)
    settings = load_settings()
    out.mkdir(parents=True, exist_ok=True)
    st = _store(store, out, settings)
    with make_client() as client:
        summary = run_pipeline(
            settings,
            st,
            _provider(llm, settings),
            _sources(settings, client, st, [s for s in sources.split(",") if s] or None, fixture),
            client,
            RunOptions(
                trigger=trigger,
                max_tailor=max_tailor,
                compile_pdf=not no_compile,
                allow_example_profile=allow_example_profile,
            ),
        )
    text = markdown(summary, settings.pricing.fx_usd_inr)
    typer.echo(text)
    (out / "last_run.json").write_text(json.dumps(summary, indent=2, default=str))
    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if step_summary:
        with open(step_summary, "a", encoding="utf-8") as fh:
            fh.write(text)


@app.command()
def scan(
    sources: str = typer.Option("", help="comma-separated subset, e.g. linkedin,indeed,naukri,foundit"),
    fixture: Path = typer.Option(None),
    verbose: bool = typer.Option(False, "-v"),
):
    """Fetch and filter only (no LLM, nothing saved). Shows per-source health and the kept jobs."""
    from jobbot.pipeline.filters import Filters, prerank
    from jobbot.pipeline.normalize import merge, normalize
    from jobbot.sources.base import run_sources
    from jobbot.store.local_store import LocalStore

    _setup_logging(verbose)
    settings = load_settings()
    with make_client() as client:
        results = run_sources(
            _sources(settings, client, LocalStore(), [s for s in sources.split(",") if s] or None, fixture)
        )
    for r in results:
        typer.echo(
            f"{r.source:<11} {r.status:<8} calls={r.calls:<3} results={r.results:<4} {r.error or ''}"[:160]
        )
    merged = merge([normalize(j, settings.search.locations) for r in results for j in r.jobs])
    kept, dropped = Filters(settings.search).apply(merged)
    typer.echo(f"\n{len(merged)} unique, {len(kept)} kept, dropped: {dict(dropped)}\n")
    for job in prerank(kept, settings.profile)[:40]:
        typer.echo(
            f"{job.prefilter_score:>5.2f}  {job.track or '-':<9} {job.title[:50]:<50} {job.company[:24]:<24} "
            f"{job.city or ('remote' if job.remote else job.location)[:14]:<14} {','.join(job.sources)}"
        )


@app.command()
def tailor(
    jd_file: Path = typer.Argument(..., help="text file with the job description"),
    title: str = typer.Option("Software Engineer"),
    company: str = typer.Option("Company"),
    llm: str = typer.Option("", help="gemini | anthropic | fake"),
    out: Path = typer.Option(ROOT / "out" / "manual"),
    allow_example_profile: bool = typer.Option(False),
):
    """Tailor a resume for one pasted job description, without touching any job database."""
    from jobbot.llm.ledger import Ledger
    from jobbot.models import Job
    from jobbot.report import _money
    from jobbot.store.local_store import LocalStore
    from jobbot.tailor.compile import find_engine
    from jobbot.tailor.generate import tailor_job

    _setup_logging(False)
    settings = load_settings()
    provider = _provider(llm, settings)
    if settings.profile.get("example") and not allow_example_profile and provider.name != "fake":
        raise typer.BadParameter("profile is still the example; fill it in or pass --allow-example-profile")
    store = LocalStore()
    ledger = Ledger(provider, settings.pricing, store)
    job = Job(
        id="manual",
        fingerprint="manual",
        title=title,
        company=company,
        apply_url="",
        description=jd_file.read_text(encoding="utf-8"),
    )
    models = (
        [settings.pricing.llm.anthropic_tailor_model]
        if provider.name == "anthropic"
        else settings.pricing.llm.tailor_models
    )
    outcome = tailor_job(
        job, settings.profile, ledger, models, find_engine(), settings.search.limits.max_revisions
    )
    out.mkdir(parents=True, exist_ok=True)
    (out / "resume.tex").write_text(outcome.tex, encoding="utf-8")
    if outcome.pdf:
        (out / "resume.pdf").write_bytes(outcome.pdf)
    (out / "tailoring.json").write_text(json.dumps(outcome.record(), indent=2, default=str))
    d = outcome.resume.diagnostics
    typer.echo(f"Match score {d.match_score}/100. Missing keywords: {', '.join(d.missing_keywords) or '-'}")
    typer.echo(f"Red flags: {'; '.join(d.red_flags) or '-'}")
    typer.echo(
        f"Status {outcome.status}, pages {outcome.pages}, fill {outcome.fill_ratio}, revisions {outcome.revisions}"
    )
    for issue in outcome.issues:
        typer.echo(f"  - [{issue.code}] {issue.message[:140]}")
    t = ledger.totals()
    typer.echo(
        f"Tokens: {t['input_tokens']:,} in / {t['output_tokens']:,} out / {t['thinking_tokens']:,} thinking, "
        f"cost {_money(t['cost_usd'])}. Files in {out}"
    )


@app.command()
def models():
    """List the Gemini models your GEMINI_API_KEY can use."""
    settings = load_settings()
    from jobbot.llm.gemini import GeminiProvider

    for name in GeminiProvider(settings.secrets.gemini_api_key).list_models():
        typer.echo(name)


@app.command("probe-company")
def probe_company(slug: str):
    """Check whether a company slug has a Greenhouse, Lever or Ashby board."""
    from jobbot.sources.boards import probe

    with make_client() as client:
        for board, result in probe(client, slug).items():
            typer.echo(f"{board:<11} {result}")


if __name__ == "__main__":
    app()
