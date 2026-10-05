import json

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
    summary = _run(settings, store, FakeProvider(), max_tailor=4)
    assert summary["fetched"] == 10 and summary["unique"] == 9
    assert summary["kept"] == 4 and summary["new_jobs"] == 4
    assert summary["dropped"] == {"title": 2, "location": 2, "experience": 1}
    assert summary["scored"] == 4 and summary["tailored"] == 4
    assert summary["llm"]["cost_usd"] == 0 and summary["llm"]["requests"] > 0
    providers = {b["provider"] for b in summary["balances"]}
    assert "gemini:gemini-flash-latest" in providers and "apify" in providers
    statuses = {r["status"] for r in store.db.execute("select status from jobs")}
    assert statuses == {"tailored"}
    # each tailored resume comes with a cover letter written from it
    records = [json.loads(r["record"]) for r in store.db.execute("select record from tailorings")]
    assert len(records) == 4 and all(r["cover_letter"].startswith("Dear Hiring Team") for r in records)
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


def test_jobs_saved_from_the_browser_pass_the_same_filters_and_are_used_once(settings, tmp_path):
    class InboxStore(LocalStore):
        def __init__(self, *a, **kw):
            super().__init__(*a, **kw)
            self.marked: list[str] = []

        def job_inbox(self, limit):
            if self.marked:
                return []
            row = {
                "source": "naukri",
                "location": "Gurugram, Haryana",
                "experience_text": "2-4 Yrs",
                "job_type": None,
                "posted_at": None,
            }
            return [
                row
                | {
                    "id": "in-1",
                    "url": "https://www.naukri.com/job-listings-java-developer-acme-gurugram-2-to-4-years-031026901234",
                    "url_key": "naukri:031026901234",
                    "title": "Java Developer",
                    "company": "Acme Payments",
                    "description": "Build Spring Boot microservices in Java with PostgreSQL. 2-4 years of experience.",
                },
                row
                | {
                    "id": "in-2",
                    "url": "https://www.naukri.com/job-listings-engineering-manager-acme-gurugram-031026905678",
                    "url_key": "naukri:031026905678",
                    "title": "Engineering Manager",
                    "company": "Acme Payments",
                    "description": "Lead a team of 12 Java engineers.",
                },
            ]

        def mark_inbox_processed(self, ids):
            self.marked += ids

    store = InboxStore(tmp_path / "db.sqlite", out_dir=tmp_path)
    summary = _run(settings, store, None)  # fetch only
    inbox = next(s for s in summary["sources"] if s["source"] == "inbox")
    assert inbox["results"] == 2 and store.marked == ["in-1", "in-2"]
    titles = {r["title"] for r in store.db.execute("select title from jobs where company='Acme Payments'")}
    assert titles == {
        "Java Developer"
    }  # the manager role is dropped by the title rules, like any scanned job
    sources = {
        r["source"] for r in store.db.execute("select source from job_links where url_key like 'naukri:%'")
    }
    assert sources == {"naukri"}
    again = _run(settings, store, None)
    assert next(s for s in again["sources"] if s["source"] == "inbox")["status"] == "empty"
