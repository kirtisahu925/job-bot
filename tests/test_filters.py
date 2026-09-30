import pytest

from jobbot.models import Job
from jobbot.pipeline.filters import Filters, min_years_required, prerank


@pytest.mark.parametrize(
    "text,expected",
    [
        ("We need 2-4 years of experience in Java", 2),
        ("5+ years of experience with Java and 2+ years with Kafka", 5),
        ("Minimum 3 years of professional experience", 3),
        ("3 yrs of relevant experience", 3),
        ("Our company has 10 years in business. 1-3 years experience required.", 1),
        ("No experience requirement stated", None),
        ("Experience: 4 to 6 years", 4),
    ],
)
def test_min_years_required(text, expected):
    assert min_years_required(text) == expected


def test_naukri_experience_text_wins():
    assert min_years_required("whatever 8+ years of experience", "2-5 Yrs") == 2


def _job(title, city="Bengaluru", desc="", remote=False, region=None):
    return Job(
        fingerprint=title,
        title=title,
        company="X",
        city=city,
        remote=remote,
        apply_url="https://x",
        description=desc,
        remote_region=region,
    )


def test_title_rules_use_word_boundaries(settings):
    f = Filters(settings.search)
    assert f.title_ok("Backend Developer (latest stack)")  # "test" inside "latest" must not exclude
    assert f.title_ok("SDE-2, Payments")
    assert not f.title_ok("Senior Staff Engineer")
    assert not f.title_ok(".NET Developer")
    assert not f.title_ok("QA Automation Engineer")
    assert not f.title_ok("Marketing Associate")


def test_location_and_remote_region(settings):
    f = Filters(settings.search)
    assert f.location_ok(_job("Backend Engineer"))
    assert not f.location_ok(_job("Backend Engineer", city=None))
    assert f.location_ok(_job("Backend Engineer", city=None, remote=True, region="India"))
    assert not f.location_ok(_job("Backend Engineer", city=None, remote=True, region="USA only"))


def test_apply_drops_by_reason_and_sets_track(settings):
    f = Filters(settings.search)
    jobs = [
        _job("Java Developer", desc="Spring Boot microservices. 2-4 years of experience."),
        _job("Backend Engineer", desc="We need 7+ years of experience in Java."),
        _job("Principal Engineer"),
        _job("Python Developer", city=None),
    ]
    kept, dropped = f.apply(jobs)
    assert [j.title for j in kept] == ["Java Developer"]
    assert kept[0].track == "java" and kept[0].min_years == 2
    assert dropped == {"experience": 1, "title": 1, "location": 1}


def test_prerank_orders_by_profile_skill_overlap(profile):
    a = _job("Java Developer", desc="Java, Spring Boot, PostgreSQL, Docker, Redis")
    b = _job("Developer", desc="Cobol and mainframes")
    assert [j.title for j in prerank([b, a], profile)] == ["Java Developer", "Developer"]


def _ad(title="Java Backend Developer", description="", job_type=None):
    return Job(
        fingerprint="f", title=title, company="C", apply_url="u", description=description, job_type=job_type
    )


def test_internships_under_plain_titles_are_dropped():
    from jobbot.pipeline.filters import is_internship

    # the ad says so up front, or in a telltale line further down, or the site's job type says it
    assert is_internship(
        _ad(description="Internship Opportunity: Java Backend Developer (12 Months), Remote")
    )
    assert is_internship(
        _ad(description="About us ... " * 40 + "Position: Software Development Intern. Openings: 3")
    )
    assert is_internship(_ad(description="x " * 200 + "Company: Acme\nJob Type: Full-time Internship"))
    assert is_internship(_ad(description="x " * 200 + "Internship Type: Unpaid, Project-Based"))
    assert is_internship(_ad(job_type="fulltime, internship"))
    assert is_internship(_ad(job_type="INTERN"))
    # full-time roles that merely mention the word in passing are kept
    assert not is_internship(
        _ad(description="x " * 200 + "You will mentor our summer interns. Internet stipend.")
    )
    assert not is_internship(_ad(description="x " * 200 + "Benefits: unpaid leave, learning stipend"))
    assert not is_internship(_ad(job_type="fulltime"))


def test_new_graduate_roles_are_dropped_by_title():
    from jobbot.config import load_settings

    f = Filters(load_settings().search)
    assert not f.title_ok("Software Engineer (New Graduates)")
    assert not f.title_ok("Graduate Software Engineer")
    assert f.title_ok("Full Stack Java Developer")
