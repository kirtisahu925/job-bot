from jobbot.config import load_settings
from jobbot.models import Job
from jobbot.pipeline.filters import Filters
from jobbot.preferences import apply_user_settings, merge_company_boards


def test_dashboard_choices_overlay_the_yaml_and_blank_ones_keep_it():
    settings = load_settings()
    cities_before = list(settings.search.locations.cities)
    notes = apply_user_settings(
        settings,
        {
            "preferences": {
                "target_level": "SDE-2",
                "emphasize": ["Java and Spring Boot"],
                "tracks": ["java"],
                "exclude_title_words": ["Blockchain"],
                "min_salary_lpa": 20,
            },
            "settings": {"reviewers": ["vp_hiring", "made_up"], "ats_target": 85, "fix_rounds": 0},
        },
    )
    search = settings.search
    assert list(search.tracks) == ["java"]
    assert search.locations.cities == cities_before  # left blank on the dashboard
    assert "blockchain" in search.title_exclude
    assert search.resume.reviewers == ["vp_hiring"] and search.resume.fix_rounds == 0
    assert search.ats.target == 85
    assert search.preferences == {"target_level": "SDE-2", "emphasize": ["Java and Spring Boot"]}
    assert any(n.startswith("tracks") for n in notes)


def test_claude_is_only_used_when_its_key_is_set():
    settings = load_settings()
    settings.secrets.anthropic_api_key = None
    notes = apply_user_settings(settings, {"settings": {"llm_provider": "anthropic"}})
    assert settings.pricing.llm.provider == "gemini"
    assert any("ANTHROPIC_API_KEY" in n for n in notes)


def test_invalid_choices_are_ignored_rather_than_breaking_the_run():
    settings = load_settings()
    notes = apply_user_settings(settings, {"settings": {"ats_target": 500}})
    assert settings.search.ats.target == 90 and "ignored" in notes[0]


def test_minimum_salary_drops_only_jobs_that_state_a_lower_inr_salary():
    settings = load_settings()
    apply_user_settings(settings, {"preferences": {"min_salary_lpa": 20}})
    f = Filters(settings.search)

    def job(**kw):
        return Job(
            id="j", fingerprint="f", title="Backend Engineer", company="A", apply_url="", description="", **kw
        )

    assert f.salary_ok(job())  # no salary stated
    assert f.salary_ok(job(salary_max=2_500_000, currency="INR"))
    assert not f.salary_ok(job(salary_min=800_000, salary_max=1_200_000, currency="INR"))
    assert f.salary_ok(job(salary_max=90_000, currency="USD"))


def test_boards_from_the_companies_page_join_the_scan_once():
    settings = load_settings()
    merge_company_boards(
        settings,
        [
            {"board": "greenhouse", "slug": "remotecom", "name": "Remote"},  # already in companies.yaml
            {"board": "lever", "slug": "acme", "name": "Acme"},
            {"board": "nope", "slug": "x", "name": "X"},
        ],
    )
    assert [c.slug for c in settings.companies.greenhouse].count("remotecom") == 1
    assert [c.slug for c in settings.companies.lever] == ["acme"]


def test_job_titles_you_want_are_searched_everywhere_and_may_head_the_resume():
    from jobbot.pipeline.filters import Filters
    from jobbot.sources.base import build_sources

    settings = load_settings()
    notes = apply_user_settings(
        settings, {"preferences": {"target_roles": ["Full Stack Java Developer", "Salesforce Developer"]}}
    )
    search = settings.search
    assert search.extra_queries == ["Full Stack Java Developer", "Salesforce Developer"]
    # a title you asked for passes even though "salesforce" is on the skip list
    assert Filters(search).title_ok("Salesforce Developer")
    assert any("salesforce" in n for n in notes)
    assert "Full Stack Java Developer" in settings.profile["allowed_titles"]
    linkedin = next(s for s in build_sources(settings, client=None) if s.name == "linkedin")
    assert linkedin.queries[-2:] == ["Full Stack Java Developer", "Salesforce Developer"]


def test_job_age_sets_every_sites_window_and_drops_older_jobs():
    from datetime import UTC, datetime, timedelta

    import httpx

    from jobbot.sources.base import build_sources

    settings = load_settings()
    notes = apply_user_settings(settings, {"preferences": {"max_job_age_days": 3}})
    assert "jobs posted within: 3 days" in notes
    sources = {s.name: s for s in build_sources(settings, httpx.Client())}
    assert sources["linkedin"].conf["hours_old"] == 72 and sources["indeed"].conf["hours_old"] == 72
    assert sources["adzuna"].max_days_old == 3
    assert sources["jsearch"].date_posted == "3days"
    assert sources["greenhouse"].max_age == timedelta(days=3)

    now = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)

    def posted(days_ago: float | None) -> Job:
        when = None if days_ago is None else now - timedelta(days=days_ago)
        return Job(
            fingerprint=str(days_ago), title="Java Developer", company="Acme", city="Gurugram", posted_at=when
        )

    kept, dropped = Filters(settings.search).apply([posted(1), posted(3.2), posted(4), posted(None)], now)
    # by calendar day: 3.2 days back is still the third day; a job with no date is kept
    assert [j.fingerprint for j in kept] == ["1", "3.2", "None"]
    assert dropped["too old"] == 1


def test_without_a_job_age_each_site_keeps_its_own_window():
    import httpx

    from jobbot.sources.base import build_sources

    settings = load_settings()
    apply_user_settings(settings, {"preferences": {}})
    sources = {s.name: s for s in build_sources(settings, httpx.Client())}
    assert sources["linkedin"].conf["hours_old"] == 24 and sources["indeed"].conf["hours_old"] == 13
    assert sources["adzuna"].max_days_old == 1 and sources["jsearch"].date_posted == "today"
    invalid = apply_user_settings(load_settings(), {"preferences": {"max_job_age_days": 5}})
    assert (
        len(invalid) == 1 and "ignored" in invalid[0]
    )  # not one of the choices: ignored, the run carries on


def test_deal_breakers_drop_jobs_before_any_ai_call():
    from jobbot.pipeline.filters import same_company

    settings = load_settings()
    apply_user_settings(
        settings,
        {
            "preferences": {
                "skip_companies": ["Acme Corp"],
                "skip_phrases": ["night shift", "service agreement"],
                "skip_it_services": True,
            }
        },
    )

    def ad(company: str, description: str = "Java and Spring Boot microservices.") -> Job:
        return Job(
            fingerprint=company + description[:8],
            title="Java Developer",
            company=company,
            city="Pune",
            description=description,
        )

    jobs = [
        ad("Acme Corp India Pvt Ltd"),  # a skipped company, with its legal suffixes
        ad("Infosys BPM"),  # a division of a listed IT-services firm
        ad("Stackfold", "Java backend. Rotational night shift for US clients."),
        ad("Ledgerly", "Java backend. Sign a 2-year service agreement."),
        ad("Infosysly Labs"),  # only starts with the same letters
        ad("Ledgerly"),
    ]
    kept, dropped = Filters(settings.search).apply(jobs)
    assert [j.company for j in kept] == ["Infosysly Labs", "Ledgerly"]
    assert dropped["skipped company"] == 2 and dropped["deal-breaker"] == 2
    assert same_company("Tata Consultancy Services", "Tata Consultancy Services Limited")
    assert not same_company("Target", "Targetprocess")
