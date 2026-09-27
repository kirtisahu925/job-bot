import httpx
import pytest

from jobbot.llm.fake import FakeProvider
from jobbot.report import markdown
from jobbot.run import ExampleProfileError, RunOptions, run
from jobbot.sources.fixture import FixtureSource
from jobbot.store.local_store import LocalStore
from tests.conftest import FIXTURES


def _run(settings, store, provider, **opts):
    with httpx.Client() as client:
        return run(
            settings,
            store,
            provider,
            [FixtureSource(FIXTURES / "sample_jobs.json")],
            client,
            RunOptions(compile_pdf=False, **opts),
        )


def test_end_to_end_offline(settings, tmp_path):
    store = LocalStore(tmp_path / "db.sqlite", out_dir=tmp_path)
    summary = _run(settings, store, FakeProvider())
    assert summary["fetched"] == 10 and summary["unique"] == 9
    assert summary["kept"] == 4 and summary["new_jobs"] == 4
    assert summary["dropped"] == {"title": 2, "location": 2, "experience": 1}
    assert summary["scored"] == 4 and summary["tailored"] == 4
    assert summary["llm"]["cost_usd"] == 0 and summary["llm"]["requests"] > 0
    providers = {b["provider"] for b in summary["balances"]}
    assert "gemini:gemini-flash-latest" in providers and "apify" in providers
    statuses = {r["status"] for r in store.db.execute("select status from jobs")}
    assert statuses == {"tailored"}
    assert "Balances" in markdown(summary)

    # second run: everything is already known, nothing new to score or tailor
    again = _run(settings, store, FakeProvider())
    assert again["new_jobs"] == 0 and again["already_known"] == 4 and again["tailored"] == 0


def test_queued_job_is_tailored_first(settings, tmp_path):
    store = LocalStore(tmp_path / "db.sqlite", out_dir=tmp_path)
    _run(settings, store, None)  # fetch only
    job_id = store.db.execute("select id from jobs where company='Orbit Labs'").fetchone()[0]
    store.update_job(job_id, {"status": "tailor_queued"})
    summary = _run(settings, store, FakeProvider(), max_tailor=1, score=False)
    assert summary["tailored"] == 1
    assert store.get_job(job_id).status == "tailored"


def test_quota_exhaustion_stops_tailoring_but_keeps_run(settings, tmp_path):
    store = LocalStore(tmp_path / "db.sqlite", out_dir=tmp_path)
    provider = FakeProvider(rate_limit_models={"gemini-flash-latest", "gemini-flash-lite-latest"})
    summary = _run(settings, store, provider)
    assert summary["scored"] == 0 and summary["tailored"] == 0
    status = store.db.execute("select status from runs").fetchone()[0]
    assert status == "ok"


def test_example_profile_is_refused_for_real_llms(settings):
    class Real(FakeProvider):
        name = "gemini"

    with pytest.raises(ExampleProfileError):
        _run(settings, LocalStore(), Real())
