"""Career-ops style evaluation on scored jobs: a do-not-apply verdict and posting legitimacy."""

from datetime import UTC, datetime, timedelta

from jobbot.models import Job
from jobbot.scoring import JobScore
from jobbot.store.local_store import LocalStore

NOW = datetime(2026, 9, 30, 6, 0, tzinfo=UTC)


def _job(**kw) -> Job:
    base = dict(
        id="j1", fingerprint="f1", title="Java Backend Engineer", company="Acme", apply_url="", description=""
    )
    return Job(**{**base, **kw})


def _score(**kw) -> JobScore:
    return JobScore(
        **{"job_id": "j1", "score": 80, "track": "java", "reason": "fits", "missing_keywords": [], **kw}
    )


def test_a_hard_stop_always_means_do_not_apply():
    s = _score(verdict="apply", hard_stops=['JD says "no visa sponsorship"'])
    s.apply_rules(_job(), NOW)
    assert s.verdict == "skip"


def test_an_old_posting_is_flagged_without_changing_the_verdict():
    s = _score(verdict="apply")
    s.apply_rules(_job(posted_at=NOW - timedelta(days=45)), NOW)
    assert s.verdict == "apply"
    assert s.legitimacy == "caution"
    assert "posted 45 days ago" in s.signals


def test_a_fresh_posting_keeps_the_models_call():
    s = _score(legitimacy="suspicious", signals=["asks for a registration fee"])
    s.apply_rules(_job(posted_at=NOW - timedelta(days=2)), NOW)
    assert s.legitimacy == "suspicious" and s.signals == ["asks for a registration fee"]


def test_signals_and_hard_stops_are_capped_at_three():
    s = _score(signals=list("abcde"), hard_stops=list("wxyz"))
    s.apply_rules(_job(), NOW)
    assert len(s.signals) == 3 and len(s.hard_stops) == 3


def test_older_score_payloads_still_parse():
    s = JobScore.model_validate(
        {"job_id": "j1", "score": 70, "track": "java", "reason": "r", "missing_keywords": []}
    )
    assert (s.verdict, s.legitimacy, s.signals, s.hard_stops) == ("maybe", "high", [], [])


def test_do_not_apply_jobs_never_spend_a_resume():
    store = LocalStore()
    run = store.start_run("test")
    jobs = [
        _job(id="skip", fingerprint="f-skip", title="A"),
        _job(id="apply", fingerprint="f-apply", title="B"),
    ]
    new, _ = store.upsert_jobs(run, jobs)
    ids = {j.title: j.id for j in new}  # the store assigns its own ids
    store.update_job(ids["A"], {"llm_score": 95, "verdict": "skip", "hard_stops": ["relocation to Dubai"]})
    store.update_job(ids["B"], {"llm_score": 80, "verdict": "apply", "legitimacy_signals": []})
    picked = [j.id for j in store.tailor_candidates(5, 60)]
    assert picked == [ids["B"]]
