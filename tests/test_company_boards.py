"""Career pages for the companies on the Companies page: finding their boards, and reading Workday sites."""

from datetime import UTC, datetime, timedelta

import httpx
import respx

from jobbot.config import Company, load_settings
from jobbot.sources.discover import board_from_url, discover_boards, slug_candidates
from jobbot.sources.workday import WorkdaySource, posted_on


def test_career_page_links_and_name_guesses():
    assert board_from_url("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/x_R1") == (
        "workday",
        "nvidia/wd5/NVIDIAExternalCareerSite",
    )
    assert board_from_url("https://job-boards.greenhouse.io/remotecom") == ("greenhouse", "remotecom")
    assert board_from_url("https://jobs.lever.co/cred/1234") == ("lever", "cred")
    assert board_from_url("https://www.example.com/careers") is None
    assert slug_candidates("Walmart Global Tech") == ["walmartglobaltech", "walmart-global-tech"]
    assert slug_candidates("JPMorgan Chase & Co.") == ["jpmorganchase", "jpmorgan-chase"]
    assert slug_candidates("AMD") == ["amd"]


class CompaniesStore:
    def __init__(self, rows):
        self.rows, self.updates = rows, {}

    def companies_to_check(self, limit, checked_before):
        return self.rows[:limit]

    def update_company(self, company_id, fields):
        self.updates[company_id] = fields


@respx.mock
def test_boards_are_found_by_name_or_known_workday_site_and_misses_are_dated():
    respx.get("https://boards-api.greenhouse.io/v1/boards/browserstack/jobs").mock(
        return_value=httpx.Response(200, json={"jobs": [{"id": 1}]})
    )
    respx.post("https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs").mock(
        return_value=httpx.Response(200, json={"total": 120, "jobPostings": []})
    )
    # an empty board does not count, and everything else does not exist
    respx.get("https://api.lever.co/v0/postings/nobody?mode=json&limit=5").mock(
        return_value=httpx.Response(200, json=[])
    )
    respx.route().mock(return_value=httpx.Response(404))
    store = CompaniesStore(
        [
            {"id": "c1", "name": "BrowserStack", "careers_url": None},
            {"id": "c2", "name": "NVIDIA", "careers_url": None},
            {"id": "c3", "name": "Nobody", "careers_url": None},
        ]
    )
    with httpx.Client() as client:
        found = discover_boards(store, client, load_settings())
    assert found == [
        {"board": "greenhouse", "slug": "browserstack", "name": "BrowserStack"},
        {"board": "workday", "slug": "nvidia/wd5/NVIDIAExternalCareerSite", "name": "NVIDIA"},
    ]
    assert store.updates["c1"]["board"] == "greenhouse" and store.updates["c2"]["board_slug"].startswith(
        "nvidia/"
    )
    assert set(store.updates["c3"]) == {"board_checked_at"}  # checked again in two weeks


@respx.mock
def test_workday_keeps_postings_in_india_and_reads_them_in_full():
    api = "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External"
    respx.post(f"{api}/jobs").mock(
        return_value=httpx.Response(
            200,
            json={
                "total": 3,
                "jobPostings": [
                    {
                        "title": "Java Developer",
                        "externalPath": "/job/Bengaluru/Java-Developer_R1",
                        "locationsText": "Bengaluru, India",
                        "postedOn": "Posted 2 Days Ago",
                    },
                    {"title": "SRE", "externalPath": "/job/Austin/SRE_R2", "locationsText": "Austin, TX"},
                    {
                        "title": "Backend Engineer",
                        "externalPath": "/job/x/Backend-Engineer_R3",
                        "locationsText": "2 Locations",
                    },
                ],
            },
        )
    )
    respx.get(f"{api}/job/Bengaluru/Java-Developer_R1").mock(
        return_value=httpx.Response(
            200,
            json={
                "jobPostingInfo": {
                    "title": "Java Developer",
                    "jobDescription": "<p>Spring Boot services in Java.</p>",
                    "location": "Bengaluru, India",
                    "jobReqId": "R1",
                    "externalUrl": "https://acme.wd5.myworkdayjobs.com/External/job/Bengaluru/Java-Developer_R1",
                    "timeType": "Full time",
                }
            },
        )
    )
    respx.get(f"{api}/job/x/Backend-Engineer_R3").mock(
        return_value=httpx.Response(
            200,
            json={
                "jobPostingInfo": {
                    "title": "Backend Engineer",
                    "location": "Austin, TX",
                    "additionalLocations": ["Pune, India"],
                }
            },
        )
    )
    with httpx.Client() as client:
        source = WorkdaySource(client, [Company(slug="acme/wd5/External", name="Acme")], 3650, ["java"])
        result = source.run()
    assert result.status == "ok"
    assert [(j.title, j.location) for j in result.jobs] == [
        ("Java Developer", "Bengaluru, India"),
        ("Backend Engineer", "Austin, TX; Pune, India"),
    ]
    assert result.jobs[0].source_job_id == "R1" and result.jobs[0].job_type == "Full time"
    assert result.jobs[1].url == "https://acme.wd5.myworkdayjobs.com/External/job/x/Backend-Engineer_R3"


def test_workday_posting_age():
    now = datetime(2026, 10, 5, tzinfo=UTC)
    assert posted_on("Posted Today", now) == now
    assert posted_on("Posted 3 Days Ago", now) == now - timedelta(days=3)
    assert posted_on("Posted 30+ Days Ago", now) == now - timedelta(days=31)
    assert posted_on("", now) is None
