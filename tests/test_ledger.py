from datetime import UTC, datetime

import pytest

from jobbot.config import ModelPrice, PricingConfig
from jobbot.llm.base import BudgetExceeded, QuotaExhausted
from jobbot.llm.fake import FakeProvider
from jobbot.llm.ledger import Ledger, quota_day_start
from jobbot.models import LLMUsage
from jobbot.scoring import ScoreBatch
from jobbot.store.local_store import LocalStore

USER = '{"candidate": {"skills": {"L": ["Java"]}}, "tracks": {"java": "Java"}, "jobs": [{"job_id": "1", "title": "Java Dev", "description": "java"}]}'


def pricing(**models) -> PricingConfig:
    return PricingConfig(
        models={k: ModelPrice(**v) for k, v in models.items()},
        shadow_model="paid",
        budgets={"anthropic": {"monthly_budget_usd": 1.0}},
    )


def test_fallback_on_rate_limit_and_usage_recorded():
    store = LocalStore()
    provider = FakeProvider(rate_limit_models={"flash"})
    ledger = Ledger(
        provider,
        pricing(
            flash={"provider": "gemini", "tier": "free", "daily_request_cap": 5},
            lite={"provider": "gemini", "tier": "free"},
            paid={"provider": "anthropic", "input": 2, "output": 10},
        ),
        store,
    )
    out = ledger.call(
        purpose="score",
        models=["flash", "lite"],
        system="s",
        user=USER,
        schema=ScoreBatch,
        max_output_tokens=100,
    )
    assert out.results[0].job_id == "1"
    assert [(r.model, r.status) for r in ledger.rows] == [("flash", "rate_limited"), ("lite", "ok")]
    ok = ledger.rows[1]
    assert ok.cost_usd == 0 and ok.shadow_cost_usd > 0
    # flash is exhausted for the rest of the run
    ledger.call(
        purpose="score",
        models=["flash", "lite"],
        system="s",
        user=USER,
        schema=ScoreBatch,
        max_output_tokens=100,
    )
    assert provider.calls[-1][0] == "lite"


def test_daily_cap_counts_previous_runs():
    store = LocalStore()
    store.record_llm_usage(
        "r0", [LLMUsage(provider="gemini", model="flash", purpose="tailor") for _ in range(3)]
    )
    ledger = Ledger(
        FakeProvider(), pricing(flash={"provider": "gemini", "tier": "free", "daily_request_cap": 3}), store
    )
    with pytest.raises(QuotaExhausted):
        ledger.call(
            purpose="score", models=["flash"], system="s", user=USER, schema=ScoreBatch, max_output_tokens=100
        )
    assert ledger.rows[-1].status == "skipped_cap"


def test_paid_budget_and_topup_balance_enforced():
    store = LocalStore()
    p = pricing(paid={"provider": "anthropic", "tier": "paid", "input": 5, "output": 25})
    store.record_llm_usage(
        "r0", [LLMUsage(provider="anthropic", model="paid", purpose="tailor", cost_usd=1.2)]
    )
    with pytest.raises(BudgetExceeded, match="monthly budget"):
        Ledger(FakeProvider(), p, store).call(
            purpose="t", models=["paid"], system="s", user=USER, schema=ScoreBatch, max_output_tokens=10
        )
    store2 = LocalStore()
    p.budgets = {}
    store2.add_topup("anthropic", 1.0, datetime(2026, 1, 1, tzinfo=UTC))
    store2.record_llm_usage(
        "r0", [LLMUsage(provider="anthropic", model="paid", purpose="tailor", cost_usd=1.0)]
    )
    with pytest.raises(BudgetExceeded, match="credit balance"):
        Ledger(FakeProvider(), p, store2).call(
            purpose="t", models=["paid"], system="s", user=USER, schema=ScoreBatch, max_output_tokens=10
        )


def test_cost_math_with_cache():
    p = PricingConfig(models={"m": ModelPrice(provider="anthropic", input=5, output=25, cache_read=0.5)})
    # 1M input of which 400k cached, 100k output
    assert round(p.cost("m", 1_000_000, 100_000, 400_000), 4) == round(0.6 * 5 + 0.4 * 0.5 + 0.1 * 25, 4)


def test_quota_day_starts_at_pacific_midnight():
    start = quota_day_start(datetime(2026, 9, 26, 4, 30, tzinfo=UTC))  # 10:00 IST = 21:30 PDT on the 25th
    assert start == datetime(2026, 9, 25, 7, 0, tzinfo=UTC)
