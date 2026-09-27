import math

import httpx
import respx

from jobbot.config import Company
from jobbot.models import SourceResult
from jobbot.sources.apify import ApifySource, items_to_jobs, render_input
from jobbot.sources.base import Source, run_sources
from jobbot.sources.boards import AshbySource, GreenhouseSource, LeverSource
from jobbot.sources.feeds import AdzunaSource, JSearchSource, RemotiveSource
from jobbot.sources.foundit import parse_search
from jobbot.sources.jobspy_sites import JobSpySource, rows_to_jobs
from tests.conftest import fixture_json


def test_adzuna_parse():
    jobs = AdzunaSource.parse(fixture_json("adzuna.json"))
    assert [j.company for j in jobs] == ["Nimbus Tech", "Pixel Works"]
    assert jobs[0].salary_min == 900000 and jobs[0].location.startswith("Gurgaon")


def test_jsearch_parse_uses_apply_link():
    job = JSearchSource.parse(fixture_json("jsearch.json"))[0]
    assert job.apply_url.startswith("https://jobs.lever.co/") and job.location == "Hyderabad, Telangana, IN"


def test_board_parsers():
    gh = GreenhouseSource.parse(fixture_json("greenhouse.json"), "Acme Fintech")[0]
    assert gh.company == "Acme Fintech" and gh.location == "Bengaluru" and "&lt;" in gh.description
    lv = LeverSource.parse(fixture_json("lever.json"), "Quanta")[0]
    assert "2-5 years" in lv.description and lv.apply_url.endswith("/apply")
    ab = AshbySource.parse(fixture_json("ashby.json"), "Acme")[0]
    assert ab.remote and "Bengaluru" in ab.location


def test_remotive_parse_keeps_region():
    job = RemotiveSource.parse(fixture_json("remotive.json"))[0]
    assert job.remote and job.remote_region == "India"


def test_foundit_parse_and_shape_change_is_reported():
    job = parse_search(fixture_json("foundit_search.json"))[0]
    assert job.url == "https://www.foundit.in/job/full-stack-developer-brightcart-noida-41234567"
    assert (
        job.location == "Noida"
        and job.experience_text == "1-3 years"
        and "Key skills: Node.js, React" in job.description
    )
    try:
        parse_search({"unexpected": {"shape": True}})
    except ValueError as exc:
        assert "unrecognised" in str(exc)
    else:
        raise AssertionError("shape change must raise so the source shows as broken")


def test_jobspy_rows_handle_nan_and_direct_links():
    rows = [
        {
            "id": "li-1",
            "site": "linkedin",
            "job_url": "https://www.linkedin.com/jobs/view/1",
            "job_url_direct": float("nan"),
            "title": "Java Developer",
            "company": "Acme",
            "location": "Pune, MH, IN",
            "is_remote": False,
            "description": "Spring",
            "min_amount": math.nan,
            "date_posted": "2026-09-26",
        },
        {
            "id": "nk-1",
            "site": "naukri",
            "job_url": "https://www.naukri.com/job-listings-x-123456789",
            "job_url_direct": "https://careers.acme.com/1",
            "title": "Python Developer",
            "company": None,
            "location": "Noida",
            "experience_range": "2-5 Yrs",
            "description": None,
        },
        {"id": "bad", "title": None, "job_url": "https://x"},
    ]
    jobs = rows_to_jobs("linkedin", rows)
    assert len(jobs) == 2
    assert jobs[0].apply_url is None and jobs[0].salary_min is None
    assert jobs[1].apply_url == "https://careers.acme.com/1" and jobs[1].company == "Unknown"
    assert jobs[1].experience_text == "2-5 Yrs"


class _DF:
    def __init__(self, rows):
        self.rows = rows
        self.empty = not rows

    def to_dict(self, orient):
        return self.rows


def test_jobspy_source_keeps_results_when_one_query_is_blocked():
    calls = []

    def scraper(**kw):
        calls.append(kw["search_term"])
        if kw["search_term"] == "q2":
            raise RuntimeError("429 Too Many Requests")
        return _DF(
            [
                {
                    "id": "1",
                    "job_url": "https://www.linkedin.com/jobs/view/1",
                    "title": "Java Developer",
                    "company": "A",
                }
            ]
        )

    result = JobSpySource("linkedin", ["q1", "q2"], {"results_wanted": 5}, scraper=scraper, pause_s=0).run()
    assert calls == ["q1", "q2"]
    assert result.status == "ok" and result.results == 1 and "1 of 2 queries failed" in result.error


def test_jobspy_source_all_blocked():
    def scraper(**kw):
        raise RuntimeError("LinkedIn responded with 429")

    result = JobSpySource("linkedin", ["q1"], {}, scraper=scraper, pause_s=0).run()
    assert result.status == "blocked" and result.results == 0


class _Boom(Source):
    name = "boom"

    def fetch(self):
        raise KeyError("items")


class _Ok(Source):
    name = "ok"

    def fetch(self):
        return SourceResult(source="ok", calls=1)


def test_run_sources_isolates_failures():
    results = run_sources([_Boom(), _Ok()])
    assert [(r.source, r.status) for r in results] == [("boom", "broken"), ("ok", "ok")]


@respx.mock
def test_adzuna_fetch_respects_daily_cap():
    route = respx.get(url__regex=r"https://api\.adzuna\.com/v1/api/jobs/in/search/\d+").mock(
        return_value=httpx.Response(200, json=fixture_json("adzuna.json"))
    )
    with httpx.Client() as client:
        src = AdzunaSource(
            client, "id", "key", ["java", "python"], {"pages": 2, "daily_cap": 199}, lambda s: 198
        )
        result = src.run()
    assert route.call_count == 1 and result.calls == 1 and result.remaining == 0
    assert "daily cap" in result.error


@respx.mock
def test_jsearch_reads_remaining_quota_header():
    respx.get("https://jsearch.p.rapidapi.com/search").mock(
        return_value=httpx.Response(
            200, json=fixture_json("jsearch.json"), headers={"x-ratelimit-requests-remaining": "57"}
        )
    )
    with httpx.Client() as client:
        result = JSearchSource(client, "k", ["java"], {"monthly_cap": 190}, lambda s: 10).run()
    assert result.remaining == 57 and result.results == 1


def test_jsearch_skips_without_key():
    with httpx.Client() as client:
        assert JSearchSource(client, None, ["java"], {}, lambda s: 0).run().status == "skipped"


@respx.mock
def test_board_source_reports_bad_slug_but_keeps_good_one():
    respx.get("https://boards-api.greenhouse.io/v1/boards/good/jobs").mock(
        return_value=httpx.Response(200, json=fixture_json("greenhouse.json"))
    )
    respx.get("https://boards-api.greenhouse.io/v1/boards/bad/jobs").mock(return_value=httpx.Response(404))
    with httpx.Client() as client:
        result = GreenhouseSource(
            client, [Company(slug="good", name="G"), Company(slug="bad", name="B")], 3650
        ).run()
    assert result.results == 1 and result.status == "ok" and "bad: error" in result.error


def test_apify_items_and_input_template():
    job = items_to_jobs("wellfound", fixture_json("apify_items.json"))[0]
    assert job.remote and job.company == "Tiny Startup"
    assert render_input({"keyword": "{query}", "location": "India"}, "backend engineer") == {
        "keyword": "backend engineer",
        "location": "India",
    }


@respx.mock
def test_apify_run_records_cost_and_items():
    respx.post(url__regex=r"https://api\.apify\.com/v2/acts/.+/runs").mock(
        return_value=httpx.Response(201, json={"data": {"id": "r1", "status": "RUNNING"}})
    )
    respx.get(url__regex=r"https://api\.apify\.com/v2/actor-runs/r1.*").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {"id": "r1", "status": "SUCCEEDED", "defaultDatasetId": "d1", "usageTotalUsd": 0.021}
            },
        )
    )
    respx.get(url__regex=r"https://api\.apify\.com/v2/datasets/d1/items.*").mock(
        return_value=httpx.Response(200, json=fixture_json("apify_items.json"))
    )
    conf = {
        "actor_id": "someone~wellfound",
        "input": {"keyword": "{query}"},
        "max_charge_usd": 0.1,
        "timeout_s": 60,
    }
    with httpx.Client() as client:
        result = ApifySource("wellfound", client, "tok", conf, ["backend"], poll_s=1).run()
    assert result.status == "ok" and result.results == 1 and abs(result.cost_usd - 0.021) < 1e-9


@respx.mock
def test_apify_failed_run_still_charges():
    respx.post(url__regex=r"https://api\.apify\.com/v2/acts/.+/runs").mock(
        return_value=httpx.Response(
            201, json={"data": {"id": "r2", "status": "FAILED", "usageTotalUsd": 0.004}}
        )
    )
    conf = {"actor_id": "a~b", "timeout_s": 60}
    with httpx.Client() as client:
        result = ApifySource("wellfound", client, "tok", conf, ["backend"]).run()
    assert result.status == "error" and abs(result.cost_usd - 0.004) < 1e-9
