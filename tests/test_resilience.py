"""A busy model or a broken source must cost one batch or one source, never the whole run."""

import httpx

from jobbot.config import PROFILE_PATH, ModelPrice, PricingConfig, load_profile, load_settings
from jobbot.llm.base import LLMError
from jobbot.llm.fake import FakeProvider
from jobbot.llm.ledger import Ledger
from jobbot.models import Job
from jobbot.scoring import canonical_track, score_jobs
from jobbot.sources.base import Source, describe
from jobbot.store.local_store import LocalStore


class BusyFirst(FakeProvider):
    """Fails the first `busy` calls like Gemini's 503 "high demand", then answers."""

    def __init__(self, busy: int, **kw):
        super().__init__(**kw)
        self.busy = busy

    def generate(self, *, model, system, user, schema, max_output_tokens):
        if self.busy:
            self.busy -= 1
            self.calls.append((model, "busy"))
            raise LLMError(f"{model}: server error after retries: 503 UNAVAILABLE")
        return super().generate(
            model=model, system=system, user=user, schema=schema, max_output_tokens=max_output_tokens
        )


def _jobs(n: int) -> list[Job]:
    return [
        Job(
            id=f"j{i}",
            fingerprint=f"f{i}",
            title="Java Backend Engineer",
            company=f"C{i}",
            apply_url="",
            description="Java, Spring Boot, PostgreSQL, REST APIs",
        )
        for i in range(n)
    ]


def _setup(provider, batch_size=2):
    settings = load_settings()
    cfg = settings.search.model_copy(deep=True)
    cfg.limits.score_batch_size = batch_size
    pricing = PricingConfig(
        models={
            "lite": ModelPrice(provider="gemini", tier="free"),
            "flash": ModelPrice(provider="gemini", tier="free"),
        },
        shadow_model="lite",
        budgets={},
    )
    return cfg, Ledger(provider, pricing, LocalStore())


def test_a_failed_batch_is_skipped_and_scoring_continues():
    provider = BusyFirst(busy=1)
    cfg, ledger = _setup(provider)
    scores = score_jobs(_jobs(6), load_profile(PROFILE_PATH), cfg, ledger, ["lite"])
    assert set(scores) == {"j2", "j3", "j4", "j5"}  # batch 1 lost, batches 2 and 3 scored


def test_the_fallback_model_answers_when_the_first_is_busy():
    provider = BusyFirst(busy=1)
    cfg, ledger = _setup(provider)
    scores = score_jobs(_jobs(2), load_profile(PROFILE_PATH), cfg, ledger, ["lite", "flash"])
    assert set(scores) == {"j0", "j1"}
    assert [m for m, *_ in provider.calls][:2] == ["lite", "flash"]


def test_scoring_stops_when_every_model_is_rate_limited():
    provider = FakeProvider(rate_limit_models={"lite"})
    cfg, ledger = _setup(provider)
    assert score_jobs(_jobs(6), load_profile(PROFILE_PATH), cfg, ledger, ["lite"]) == {}
    assert len(provider.calls) == 1


def test_scoring_stops_after_two_failed_batches_in_a_row():
    provider = BusyFirst(busy=99)
    cfg, ledger = _setup(provider)
    assert score_jobs(_jobs(8), load_profile(PROFILE_PATH), cfg, ledger, ["lite"]) == {}
    assert len(provider.calls) == 2


def test_source_errors_keep_what_the_server_said():
    request = httpx.Request("GET", "https://jsearch.p.rapidapi.com/search?query=java")
    response = httpx.Response(404, request=request, json={"message": "Endpoint '/search' does not exist"})
    exc = httpx.HTTPStatusError("404", request=request, response=response)
    text = describe(exc)
    assert text.startswith("HTTP 404 from jsearch.p.rapidapi.com/search:")
    assert "does not exist" in text

    class Broken(Source):
        name = "jsearch"

        def fetch(self):
            raise exc

    result = Broken().run()
    assert result.status == "error" and "does not exist" in result.error


def test_track_labels_from_the_model_become_track_names():
    cfg = load_settings().search
    assert canonical_track("java", cfg) == "java"
    assert canonical_track("Java backend", cfg) == "java"
    assert canonical_track("Full-stack JS / Node", cfg) == "fullstack"
    assert canonical_track("Python Backend", cfg) == "python"
    assert canonical_track("devops", cfg, "java") == "java"
    assert canonical_track(None, cfg) is None
