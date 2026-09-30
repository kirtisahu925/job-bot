import json

import pytest

from jobbot.ats.score import JDKeywords, compute, improvement_requests, title_overlap
from jobbot.ats.skills import canonical, expand_item, in_text, normalize_text, profile_vocabulary
from jobbot.config import PROFILE_PATH, load_profile, load_settings
from jobbot.llm.base import RateLimited
from jobbot.llm.fake import FakeProvider
from jobbot.llm.ledger import Ledger
from jobbot.models import Job
from jobbot.store.local_store import LocalStore
from jobbot.tailor.compile import find_engine
from jobbot.tailor.generate import tailor_job
from jobbot.tailor.schema import ReviewedResume
from tests.conftest import FIXTURES, requires_tex


@pytest.mark.parametrize(
    "raw,canon",
    [
        ("springboot", "Spring Boot"),
        ("K8s", "Kubernetes"),
        ("Postgres", "PostgreSQL"),
        ("RESTful APIs", "REST APIs"),
        ("rbac", "Role-Based Authorization"),
        ("Gradle", "Gradle"),
        ("Some New Tool", "Some New Tool"),
    ],
)
def test_canonical(raw, canon):
    assert canonical(raw) == canon


def test_expand_compound_items():
    assert {"Azure", "Azure Functions", "Azure Blob Storage", "Azure VM"} <= set(
        expand_item("Azure (Functions, Blob Storage, VM)")
    )
    assert {"Hibernate", "JPA"} <= set(expand_item("Hibernate/JPA"))
    assert expand_item("CI/CD Pipelines")[0] == "CI/CD Pipelines"


@pytest.mark.parametrize(
    "skill,text,found",
    [
        ("Spring Boot", "Built SpringBoot services", True),
        ("Java", "JavaScript front ends", False),
        ("REST APIs", "exposed RESTful services", True),
        ("Node.js", "NodeJS workers", True),
        ("Kubernetes", "deployed on k8s", True),
        ("Git", "GitHub Actions only", False),
        ("C++", "wrote C++ code", True),
    ],
)
def test_in_text(skill, text, found):
    assert in_text(skill, normalize_text(text)) is found


PROFILE = {
    "headline": "Backend Software Engineer",
    "allowed_titles": ["Backend Software Engineer", "Software Development Engineer"],
    "years_experience": 2.4,
    "summary": "Backend engineer.",
    "experience": [{"id": "a", "bullets": ["Ran services on Kubernetes"]}],
    "skills": {"Backend": ["Java", "Spring Boot", "PostgreSQL", "Docker", "Kubernetes"]},
    "education": [{"degree": "Bachelor of Technology"}],
}
JD = JDKeywords(
    required=["Java", "Spring Boot", "Kafka", "Kubernetes"],
    preferred=["Docker", "GraphQL"],
    degree_required=True,
)


def test_compute_breakdown_fixable_and_gaps():
    resume_text = "Backend Software Engineer\nSkills: Java, Spring Boot, Kubernetes\nBachelor of Technology"
    body = "Built Java services with Spring Boot"
    r = compute(
        resume_text=resume_text,
        body_text=body,
        headline="Backend Software Engineer",
        jd=JD,
        job_title="Software Development Engineer II",
        jd_min_years=3,
        profile=PROFILE,
        format_checks={"one page": True},
    )
    assert r.matched_required == ["Java", "Spring Boot", "Kubernetes"]
    assert r.missing_fixable == ["Docker"]  # in the profile, not on the resume
    assert r.missing_gaps == ["Kafka", "GraphQL"]  # not in the profile: skills to learn
    assert r.skills_only == ["Kubernetes"]
    assert r.breakdown["required"]["points"] == pytest.approx(45 * 3 / 4, abs=0.1)
    assert r.breakdown["experience"]["points"] == pytest.approx(10 * 2.4 / 3, abs=0.1)
    assert r.breakdown["education"]["points"] == 5
    assert r.best_title == "Software Development Engineer"
    assert r.score < r.max_achievable < 100  # Kafka and GraphQL cap the honest maximum
    assert r.reach["required"] == r.breakdown["required"]["points"]  # Kafka is a gap, not fixable
    assert r.reach["preferred"] > r.breakdown["preferred"]["points"]  # Docker is fixable
    asks = improvement_requests(r, "Software Development Engineer II", "Backend Software Engineer")
    assert (
        any("Docker" in a for a in asks)
        and any("Kubernetes" in a for a in asks)
        and any("headline" in a for a in asks)
    )
    assert not any("Kafka" in a for a in asks)


def test_title_overlap_handles_levels_and_synonyms():
    assert title_overlap("SDE-2, Payments", "Software Development Engineer") == 1.0
    assert title_overlap("Java Developer (Spring)", "Java Backend Developer") == 1.0
    assert title_overlap("Senior Backend Engineer", "Backend Software Engineer") == 1.0
    assert title_overlap("Full Stack Developer", "Backend Software Engineer") < 0.5


def test_real_profile_vocabulary_covers_resume_skills():
    vocab = {canonical(v) for v in profile_vocabulary(load_profile(PROFILE_PATH))}
    assert {
        "Java",
        "Spring Boot",
        "PostgreSQL",
        "Kubernetes",
        "Azure Functions",
        "JPA",
        "Hibernate",
        "AWS",
    } <= vocab
    assert "Kafka" not in vocab


class SmartFake(FakeProvider):
    """A reviewing model that follows the ATS instructions it is given (or, when cheat=True, also invents)."""

    def __init__(self, cheat: bool = False):
        super().__init__()
        self.cheat = cheat

    def generate(self, *, model, system, user, schema, max_output_tokens):
        parsed, usage = super().generate(
            model=model, system=system, user=user, schema=schema, max_output_tokens=max_output_tokens
        )
        payload = json.loads(user) if user.startswith("{") else {}
        resume = parsed.resume if schema is ReviewedResume else parsed if "previous" in payload else None
        if resume is not None:
            words = ", ".join(payload["ats"]["supported_by_profile"][:6])
            if words not in resume.experience[0].bullets[0].text:
                resume.experience[0].bullets[0].text += f" using {words}"
            for ask in payload["problems"]:
                if ask.startswith("ATS: set headline to '"):
                    resume.headline = ask.split("'")[1]
            if self.cheat:
                resume.experience[0].bullets[1].text += " with Kafka"
        return parsed, usage


def _job():
    return Job(
        id="j",
        fingerprint="f",
        title="Software Development Engineer II - Backend (Java)",
        company="Paysure",
        apply_url="",
        description=(FIXTURES / "jd_java_backend.txt").read_text(),
        min_years=2,
    )


@requires_tex
def test_review_rounds_raise_the_score_and_keep_the_latest_good_round():
    settings = load_settings()
    profile = load_profile(PROFILE_PATH)
    ledger = Ledger(SmartFake(), settings.pricing, LocalStore())
    jd = JDKeywords(
        required=[
            "Java",
            "Spring Boot",
            "Microservices",
            "REST APIs",
            "PostgreSQL",
            "Docker",
            "Kubernetes",
            "Kafka",
        ],
        preferred=["Redis", "AWS", "System Design"],
        degree_required=True,
    )
    out = tailor_job(
        _job(),
        profile,
        ledger,
        ["gemini-flash-latest"],
        find_engine(),
        jd=jd,
        preferences={"target_level": "SDE-2"},
    )
    names = [r["name"] for r in out.rounds]
    assert names[:3] == ["build", "hiring_manager", "vp_hiring"]
    assert [r.purpose for r in ledger.rows][:3] == ["tailor", "review", "review"]
    # round 1 reasons first: it sees your preferences and names the gaps it will leave out
    build = out.rounds[0]["analysis"]
    assert "Kafka" in build["gaps"] and any("SDE-2" in p for p in build["preferences_applied"])
    assert all(r["review"]["findings"] is not None for r in out.rounds[1:3])
    assert out.pages == 1
    assert out.ats_rounds[1] > out.ats_rounds[0]
    kept = [r for r in out.rounds if r["kept"]]
    assert len(kept) == 1 and kept[0]["ats_score"] == out.ats.score and out.ats.score >= 80
    assert kept[0]["name"] != "build"  # a review round that clears the bar beats the first draft
    assert out.resume.headline == "Software Development Engineer"
    assert set(out.ats.missing_gaps) == {"Kafka", "Redis"}
    record = out.record()
    assert record["ats_score"] == out.ats.score and record["ats"]["rounds"] == out.ats_rounds
    assert record["rounds"] == out.rounds


@requires_tex
def test_invented_skills_are_never_the_winning_version():
    settings = load_settings()
    ledger = Ledger(SmartFake(cheat=True), settings.pricing, LocalStore())
    jd = JDKeywords(required=["Java", "Spring Boot", "Kafka"], preferred=[])
    out = tailor_job(
        _job(), load_profile(PROFILE_PATH), ledger, ["gemini-flash-latest"], find_engine(), jd=jd
    )
    # the reviewers' drafts claim Kafka, so the honest first draft wins even though its keyword score is lower
    assert "Kafka" in out.ats.missing_gaps
    assert not any(i.code == "unsupported" for i in out.issues)
    assert [r["name"] for r in out.rounds if r["kept"]] == ["build"]
    assert out.rounds[-1]["name"] == "fix"  # the invented claim broke a hard rule, so one fix-up ran


def test_a_review_round_that_runs_out_of_quota_keeps_the_earlier_draft():
    settings = load_settings()
    fake = FakeProvider()
    ledger = Ledger(fake, settings.pricing, LocalStore())
    real_generate = fake.generate

    def generate(**kw):
        if kw["schema"] is ReviewedResume:
            raise RateLimited("gemini-flash-latest: fake 429")
        return real_generate(**kw)

    fake.generate = generate
    out = tailor_job(_job(), load_profile(PROFILE_PATH), ledger, ["gemini-flash-latest"], None, fix_rounds=0)
    assert [r["name"] for r in out.rounds] == ["build", "hiring_manager"]
    assert out.rounds[1]["skipped"] and out.rounds[0]["kept"]
    assert any("Hiring manager review skipped" in f for f in out.fixes)
