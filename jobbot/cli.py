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


def _dashboard_settings(settings, store) -> None:
    """Lay the dashboard's Preferences and Settings over config/*.yaml for this run."""
    from jobbot.preferences import apply_user_settings, merge_company_boards

    for note in apply_user_settings(settings, store.user_settings()):
        logging.getLogger("jobbot").info("from the dashboard: %s", note)
    merge_company_boards(settings, store.company_boards())


def _find_company_boards(settings, store, client) -> None:
    """Look for the career boards of a few Companies-page companies; any found are scanned this run."""
    from jobbot.preferences import merge_company_boards
    from jobbot.sources.discover import discover_boards

    found = discover_boards(store, client, settings)
    merge_company_boards(settings, found)
    for b in found:
        logging.getLogger("jobbot").info("career board found: %s (%s %s)", b["name"], b["board"], b["slug"])


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
    _dashboard_settings(settings, st)
    with make_client() as client:
        _find_company_boards(settings, st, client)
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


def print_ats(ats) -> None:
    """Human-readable ATS breakdown for the terminal."""
    if ats is None:
        typer.echo("ATS: not scored (no JD keywords)")
        return
    verdict = "on target" if ats.score >= ats.target else "below target"
    typer.echo(
        f"ATS score {ats.score}/100 ({verdict}; target {ats.target}, best honest score {ats.max_achievable})"
    )
    for name, part in ats.breakdown.items():
        typer.echo(f"  {name:<11} {part['points']:>5} / {part['max']:<3} {part['note']}")
    typer.echo(f"  matched: {', '.join(ats.matched_required + ats.matched_preferred) or '-'}")
    if ats.missing_fixable:
        typer.echo(f"  missing but in your profile: {', '.join(ats.missing_fixable)}")
    if ats.missing_gaps:
        typer.echo(f"  gaps (skills to learn): {', '.join(ats.missing_gaps)}")


@app.command()
def tailor(
    jd_file: Path = typer.Argument(..., help="text file with the job description"),
    title: str = typer.Option("Software Engineer"),
    company: str = typer.Option("Company"),
    llm: str = typer.Option("", help="gemini | anthropic | fake"),
    out: Path = typer.Option(ROOT / "out" / "manual"),
    allow_example_profile: bool = typer.Option(False),
    template: bool = typer.Option(
        False, "--template", help="use the built-in template even if profile/resume.tex exists"
    ),
):
    """Tailor a resume for one pasted job description and print its ATS score. Nothing is saved to a database."""
    from jobbot.ats.keywords import extract_keywords
    from jobbot.llm.ledger import Ledger
    from jobbot.models import Job
    from jobbot.pipeline.filters import min_years_required
    from jobbot.report import _money
    from jobbot.store.local_store import LocalStore
    from jobbot.tailor.compile import find_engine
    from jobbot.tailor.generate import tailor_job
    from jobbot.tailor.own_resume import load_own, tailor_own_resume

    _setup_logging(False)
    settings = load_settings()
    provider = _provider(llm, settings)
    if settings.profile.get("example") and not allow_example_profile and provider.name != "fake":
        raise typer.BadParameter("profile is still the example; fill it in or pass --allow-example-profile")
    store = LocalStore()
    ledger = Ledger(provider, settings.pricing, store)
    description = jd_file.read_text(encoding="utf-8")
    job = Job(
        id="manual",
        fingerprint="manual",
        title=title,
        company=company,
        apply_url="",
        description=description,
        min_years=min_years_required(description),
    )
    llm_cfg = settings.pricing.llm
    anthropic = provider.name == "anthropic"
    score_models = [llm_cfg.anthropic_score_model] if anthropic else llm_cfg.score_models
    tailor_models = [llm_cfg.anthropic_tailor_model] if anthropic else llm_cfg.tailor_models
    jd = extract_keywords(job, ledger, score_models)
    from jobbot.run import round_options

    engine = find_engine()
    own = None if template else load_own(engine)
    rounds = round_options(settings, None)
    if own is not None:
        typer.echo(
            f"Tailoring inside profile/resume.tex ({len(own.slots)} editable lines, {own.pages or '?'} page(s))"
        )
        outcome = tailor_own_resume(job, settings.profile, own, ledger, tailor_models, jd=jd, **rounds)
    else:
        outcome = tailor_job(job, settings.profile, ledger, tailor_models, engine, jd=jd, **rounds)
    out.mkdir(parents=True, exist_ok=True)
    (out / "resume.tex").write_text(outcome.tex, encoding="utf-8")
    if outcome.pdf:
        (out / "resume.pdf").write_bytes(outcome.pdf)
    (out / "tailoring.json").write_text(json.dumps(outcome.record(), indent=2, default=str))
    d = outcome.resume.diagnostics
    typer.echo(f"Base-profile match {d.match_score}/100. Red flags: {'; '.join(d.red_flags) or '-'}")
    print_ats(outcome.ats)
    for r in outcome.rounds:
        mark = " (kept)" if r["kept"] else ""
        if r["skipped"]:
            typer.echo(f"{r['title']}: skipped, {r['skipped']}")
            continue
        typer.echo(f"{r['title']}: ATS {r['ats_score']}{mark}")
        for f in (r["review"] or {}).get("findings", []):
            typer.echo(f"  - [{f['severity']}] {f['area']}: {f['issue']} -> {f['fix']}"[:220])
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


@app.command("tailor-queued")
def tailor_queued_cmd(
    job_id: list[str] = typer.Option(None, "--job-id", help="job id(s); omit to tailor every queued job"),
    store: str = typer.Option("supabase", help="supabase | local"),
    llm: str = typer.Option("", help="gemini | anthropic | fake"),
    limit: int = typer.Option(3, help="max queued jobs when no --job-id is given"),
    out: Path = typer.Option(ROOT / "out"),
    verbose: bool = typer.Option(False, "-v"),
):
    """Tailor now: used by the dashboard/extension button through the tailor.yml workflow."""
    from jobbot.run import tailor_queued

    _setup_logging(verbose)
    settings = load_settings()
    out.mkdir(parents=True, exist_ok=True)
    st = _store(store, out, settings)
    _dashboard_settings(settings, st)
    with make_client() as client:
        summary = tailor_queued(settings, st, _provider(llm, settings), client, job_id or None, limit)
    text = markdown(summary, settings.pricing.fx_usd_inr)
    typer.echo(text)
    for item in summary.get("ats", []):
        typer.echo(
            f"ATS {item['score']} (best honest {item['max_achievable']}): {item['title']} at {item['company']}"
        )
    (out / "last_run.json").write_text(json.dumps(summary, indent=2, default=str))
    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if step_summary:
        with open(step_summary, "a", encoding="utf-8") as fh:
            fh.write(text)
    if summary.get("errors") and not summary.get("tailored"):
        raise typer.Exit(code=1)


@app.command("recompile-edits")
def recompile_edits_cmd(
    edit_id: list[str] = typer.Option(
        None, "--edit-id", help="edit id(s); omit to compile every queued edit"
    ),
    store: str = typer.Option("supabase", help="supabase | local"),
    out: Path = typer.Option(ROOT / "out"),
    verbose: bool = typer.Option(False, "-v"),
):
    """Compile resumes edited by hand in the dashboard's LaTeX editor, score them and save them (no AI calls)."""
    from jobbot.tailor.compile import find_engine
    from jobbot.tailor.recompile import process_edits

    _setup_logging(verbose)
    settings = load_settings()
    out.mkdir(parents=True, exist_ok=True)
    st = _store(store, out, settings)
    engine = find_engine()
    if engine is None:
        raise typer.BadParameter("no LaTeX engine found (install tectonic or pdflatex)")
    results = process_edits(settings, st, engine, edit_id or None)
    for r in results:
        detail = f"ATS {r.get('ats_score')}" if r["status"] == "done" else (r.get("error") or "")[-300:]
        typer.echo(f"edit {r['edit_id']}: {r['status']} {detail}")
    if not results:
        typer.echo("no queued edits")
    if any(r["status"] == "failed" for r in results):
        raise typer.Exit(code=1)


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
