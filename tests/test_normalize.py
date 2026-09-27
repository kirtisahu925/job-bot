from datetime import UTC, datetime

import pytest

from jobbot.config import Locations
from jobbot.models import RawJob
from jobbot.pipeline.normalize import (
    detect_city,
    fingerprint,
    html_to_text,
    merge,
    normalize,
    parse_dt,
    url_key,
)
from tests.conftest import fixture_json

LOCS = Locations(
    cities=["Gurugram", "Noida", "Delhi", "Bengaluru", "Hyderabad", "Pune", "Chennai"],
    aliases={"gurgaon": "Gurugram", "bangalore": "Bengaluru", "new delhi": "Delhi", "greater noida": "Noida"},
)


@pytest.mark.parametrize("url,key", list(fixture_json("url_keys.json").items()))
def test_url_key_matches_shared_fixture(url, key):
    # the Chrome extension's urlkey.js is tested against the same file
    assert url_key(url) == key


def test_fingerprint_ignores_company_suffix_and_sde_spelling():
    a = fingerprint("Acme Fintech Pvt Ltd", "Backend Engineer (SDE-2), Payments", "Bengaluru")
    b = fingerprint("Acme Fintech", "Backend Engineer (SDE 2) Payments", "Bengaluru")
    c = fingerprint("Acme Fintech", "Backend Engineer (SDE 2) Payments", "Pune")
    assert a == b
    assert a != c


def test_detect_city_prefers_first_named_and_longest_alias():
    assert detect_city("Bangalore, Hyderabad", LOCS) == "Bengaluru"
    assert detect_city("Hyderabad / Bangalore", LOCS) == "Hyderabad"
    assert detect_city("Greater Noida, UP", LOCS) == "Noida"
    assert detect_city("New Delhi", LOCS) == "Delhi"
    assert detect_city("Mumbai", LOCS) is None


def test_html_to_text_unescapes_and_strips_tags():
    text = html_to_text(
        "&lt;p&gt;Build &lt;strong&gt;Java&lt;/strong&gt; services&lt;/p&gt;&lt;ul&gt;&lt;li&gt;2-4 years&lt;/li&gt;&lt;/ul&gt;"
    )
    assert "Build" in text and "Java" in text and "<" not in text


def test_parse_dt_variants():
    assert parse_dt("2026-09-26T08:00:00Z") == datetime(2026, 9, 26, 8, tzinfo=UTC)
    assert parse_dt(1790000000000).year == 2026
    assert parse_dt("") is None
    assert parse_dt(float("nan")) is None


def test_merge_collapses_same_job_across_sites_and_prefers_company_ats_link():
    raw = [RawJob.model_validate(j) for j in fixture_json("sample_jobs.json")[:2]]
    jobs = merge([normalize(r, LOCS) for r in raw])
    assert len(jobs) == 1
    job = jobs[0]
    assert {link.url_key for link in job.links} == {
        "linkedin:4012345678",
        "greenhouse:7654321",
        "naukri:260926500123",
    }
    assert job.apply_url == "https://boards.greenhouse.io/acmefintech/jobs/7654321"
    assert job.experience_text == "2-4 Yrs"
    assert len(job.description) > 300  # kept the longer JD


def test_merge_by_shared_url_even_when_titles_differ():
    a = RawJob(
        source="jsearch",
        title="SWE Backend",
        company="Quanta",
        location="Hyderabad",
        url="https://www.google.com/x",
        apply_url="https://jobs.lever.co/quanta/0b5a3c1e-1111-2222-3333-444455556666/apply",
    )
    b = RawJob(
        source="lever",
        title="Software Engineer - Backend (Java)",
        company="Quanta",
        location="Hyderabad",
        url="https://jobs.lever.co/quanta/0b5a3c1e-1111-2222-3333-444455556666",
    )
    assert len(merge([normalize(a, LOCS), normalize(b, LOCS)])) == 1
