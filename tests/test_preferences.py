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
