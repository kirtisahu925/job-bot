import json
from datetime import UTC, datetime

import httpx
import respx

from jobbot import balances
from jobbot.models import ApiUsage, Job, JobLink, LLMUsage, SourceResult
from jobbot.store.local_store import LocalStore
from jobbot.store.supabase_store import SupabaseStore, _in
from tests.conftest import fixture_json

NOW = datetime(2026, 9, 26, 10, tzinfo=UTC)


@respx.mock
def test_apify_balance_from_live_api(settings):
    settings.secrets.apify_token = "tok"
    respx.get(url__regex=r"https://api\.apify\.com/v2/users/me/limits.*").mock(
        return_value=httpx.Response(200, json=fixture_json("apify_limits.json"))
    )
    with httpx.Client() as client:
        snap = balances.apify_snapshot(settings, LocalStore(), client, NOW)
    assert (snap.used, snap.limit, snap.remaining, snap.method) == (1.25, 5.0, 3.75, "live_api")


def test_apify_balance_falls_back_to_ledger(settings):
    store = LocalStore()
    store.record_api_usage(
        "r", [ApiUsage(source="wellfound", calls=1, results=10, status="ok", cost_usd=0.5)]
    )
    with httpx.Client() as client:
        snap = balances.apify_snapshot(settings, store, client, datetime.now(UTC))
    assert snap.method == "ledger" and snap.used == 0.5 and snap.remaining == 4.5


def test_anthropic_credit_balance_from_topups(settings):
    store = LocalStore()
    store.add_topup("anthropic", 10.0, datetime(2026, 9, 1, tzinfo=UTC))
    store.record_llm_usage(
        "r", [LLMUsage(provider="anthropic", model="claude-sonnet-5", purpose="tailor", cost_usd=2.5)]
    )
    snaps = {s.provider: s for s in balances.paid_llm_snapshots(settings, store, datetime.now(UTC))}
    credit = snaps["anthropic:credit"]
    assert (credit.used, credit.limit, credit.remaining, credit.method) == (2.5, 10.0, 7.5, "manual")
    assert snaps["anthropic"].period == "month"


def test_gemini_quota_and_low_flag(settings):
    store = LocalStore()
    store.record_llm_usage(
        "r", [LLMUsage(provider="gemini", model="gemini-flash-latest", purpose="t") for _ in range(16)]
    )
    snaps = {s.provider: s for s in balances.llm_quota_snapshots(settings, store, datetime.now(UTC))}
    flash = snaps["gemini:gemini-flash-latest"]
    assert flash.remaining == 2 and flash.low


def test_jsearch_prefers_live_remaining(settings):
    store = LocalStore()
    snaps = balances.source_quota_snapshots(
        settings, store, [SourceResult(source="jsearch", remaining=57)], NOW
    )
    js = next(s for s in snaps if s.provider == "jsearch")
    assert js.remaining == 57 and js.method == "live_api"


def test_postgrest_in_filter_quotes_values():
    assert _in(["linkedin:1", 'a"b']) == 'in.("linkedin:1","a\\"b")'


@respx.mock
def test_supabase_upsert_splits_known_and_new():
    base = "https://proj.supabase.co"
    respx.get(f"{base}/rest/v1/jobs").mock(return_value=httpx.Response(200, json=[]))
    respx.get(f"{base}/rest/v1/job_links").mock(
        return_value=httpx.Response(200, json=[{"job_id": "existing-1", "url_key": "linkedin:1"}])
    )
    inserted = respx.post(f"{base}/rest/v1/jobs").mock(
        return_value=httpx.Response(201, json=[{"id": "new-1", "fingerprint": "fp-new"}])
    )
    links = respx.post(f"{base}/rest/v1/job_links").mock(return_value=httpx.Response(201))
    known = Job(
        fingerprint="fp-known",
        title="A",
        company="C",
        apply_url="u",
        links=[
            JobLink(source="linkedin", url="https://www.linkedin.com/jobs/view/1", url_key="linkedin:1"),
            JobLink(source="naukri", url="https://naukri.com/x-123456", url_key="naukri:123456"),
        ],
    )
    fresh = Job(
        fingerprint="fp-new",
        title="B",
        company="C",
        apply_url="u",
        links=[JobLink(source="indeed", url="https://in.indeed.com/viewjob?jk=9", url_key="indeed:9")],
    )
    store = SupabaseStore(base, "eyJservice-key", httpx.Client())
    new, known_count = store.upsert_jobs("run-1", [known, fresh])
    assert known_count == 1 and [j.id for j in new] == ["new-1"]
    body = json.loads(inserted.calls[0].request.content)
    assert body[0]["fingerprint"] == "fp-new" and body[0]["first_run_id"] == "run-1"
    link_rows = json.loads(links.calls[0].request.content)
    assert {(r["job_id"], r["url_key"]) for r in link_rows} == {
        ("existing-1", "naukri:123456"),
        ("new-1", "indeed:9"),
    }
    assert inserted.calls[0].request.headers["authorization"] == "Bearer eyJservice-key"


def test_supabase_new_secret_key_goes_in_apikey_only():
    store = SupabaseStore("https://x.supabase.co", "sb_secret_abc")
    assert store.headers == {"apikey": "sb_secret_abc"}


@respx.mock
def test_a_job_with_empty_columns_still_loads():
    # a job saved from the extension has no prefilter score; one added by hand may have no location
    base = "https://proj.supabase.co"
    row = {
        "id": "j1",
        "fingerprint": "ext:manual:1",
        "title": "Full Stack Java Developer",
        "company": "Acme",
        "location": None,
        "apply_url": None,
        "description": None,
        "prefilter_score": None,
        "remote": None,
        "missing_keywords": None,
        "job_links": [],
    }
    respx.get(f"{base}/rest/v1/jobs").mock(return_value=httpx.Response(200, json=[row]))
    job = SupabaseStore(base, "eyJservice-key", httpx.Client()).get_job("j1")
    assert job is not None and job.title == "Full Stack Java Developer"
    assert (job.location, job.apply_url, job.description, job.prefilter_score) == ("", "", "", 0.0)
