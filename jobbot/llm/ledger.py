"""Every LLM call goes through the ledger: it enforces daily caps and money budgets, falls back along the
model chain on rate limits, and records tokens and cost for the Consumption page."""

from __future__ import annotations

import time
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from jobbot.config import PricingConfig
from jobbot.llm.base import BudgetExceeded, LLMError, LLMProvider, QuotaExhausted, RateLimited, RawUsage, T
from jobbot.models import LLMUsage

PACIFIC = ZoneInfo("America/Los_Angeles")


def quota_day_start(now: datetime | None = None) -> datetime:
    """Gemini daily quotas reset at midnight Pacific time."""
    now = (now or datetime.now(UTC)).astimezone(PACIFIC)
    return now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)


def month_start(now: datetime | None = None) -> datetime:
    now = now or datetime.now(UTC)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


class Ledger:
    def __init__(self, provider: LLMProvider, pricing: PricingConfig, store, now: datetime | None = None):
        self.provider = provider
        self.pricing = pricing
        self.store = store
        self.rows: list[LLMUsage] = []
        self.requests_today: dict[str, int] = dict(store.llm_requests_since(quota_day_start(now)))
        self.exhausted: set[str] = set()
        self._month = month_start(now)
        self._spent_before = {p: store.llm_cost_since(p, self._month) for p in ("anthropic",)}

    # accounting -------------------------------------------------------------
    def _record(
        self,
        purpose: str,
        model: str,
        status: str,
        usage: RawUsage | None = None,
        latency_ms: int = 0,
        error: str | None = None,
        job_id: str | None = None,
    ) -> None:
        usage = usage or RawUsage()
        out = usage.output_tokens + usage.thinking_tokens
        self.rows.append(
            LLMUsage(
                provider=self.provider.name,
                model=model,
                purpose=purpose,
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
                thinking_tokens=usage.thinking_tokens,
                cached_tokens=usage.cached_tokens,
                latency_ms=latency_ms,
                status=status,
                cost_usd=round(self.pricing.cost(model, usage.input_tokens, out, usage.cached_tokens), 6),
                shadow_cost_usd=round(self.pricing.shadow_cost(usage.input_tokens, out), 6),
                error=error,
                job_id=job_id,
            )
        )

    def run_cost(self, provider: str | None = None) -> float:
        return sum(r.cost_usd for r in self.rows if provider is None or r.provider == provider)

    def totals(self) -> dict[str, float]:
        return {
            "requests": sum(1 for r in self.rows if r.status != "skipped_cap"),
            "input_tokens": sum(r.input_tokens for r in self.rows),
            "output_tokens": sum(r.output_tokens for r in self.rows),
            "thinking_tokens": sum(r.thinking_tokens for r in self.rows),
            "cost_usd": round(self.run_cost(), 6),
            "shadow_cost_usd": round(sum(r.shadow_cost_usd for r in self.rows), 6),
        }

    def _check_budget(self, model: str) -> None:
        price = self.pricing.price(model)
        if price is None or price.tier != "paid":
            return
        provider = price.provider
        budget = self.pricing.budgets.get(provider, {}).get("monthly_budget_usd")
        spent = self._spent_before.get(provider, 0.0) + self.run_cost(provider)
        if budget is not None and spent >= budget:
            raise BudgetExceeded(f"{provider}: monthly budget ${budget:.2f} used (${spent:.2f})")
        topups = self.store.topups(provider)
        if topups:
            first = min(t["purchased_at"] for t in topups)
            first_dt = (
                first
                if isinstance(first, datetime)
                else datetime.fromisoformat(str(first).replace("Z", "+00:00"))
            )
            balance = sum(float(t["amount_usd"]) for t in topups) - self.store.llm_cost_since(
                provider, first_dt
            )
            if balance - self.run_cost(provider) <= 0:
                raise BudgetExceeded(f"{provider}: credit balance exhausted")

    # calls ----------------------------------------------------------------------
    def call(
        self,
        *,
        purpose: str,
        models: list[str],
        system: str,
        user: str,
        schema: type[T],
        max_output_tokens: int,
        job_id: str | None = None,
    ) -> T:
        errors: list[str] = []
        for model in models:
            if model in self.exhausted:
                continue
            price = self.pricing.price(model)
            cap = price.daily_request_cap if price else None
            if cap is not None and self.requests_today.get(model, 0) >= cap:
                self.exhausted.add(model)
                self._record(purpose, model, "skipped_cap", error=f"daily cap {cap} reached", job_id=job_id)
                errors.append(f"{model}: daily cap reached")
                continue
            self._check_budget(model)
            started = time.monotonic()
            try:
                parsed, usage = self.provider.generate(
                    model=model, system=system, user=user, schema=schema, max_output_tokens=max_output_tokens
                )
            except RateLimited as exc:
                self.requests_today[model] = self.requests_today.get(model, 0) + 1
                self.exhausted.add(model)
                self._record(
                    purpose,
                    model,
                    "rate_limited",
                    latency_ms=_ms(started),
                    error=str(exc)[:300],
                    job_id=job_id,
                )
                errors.append(str(exc))
                continue
            except LLMError as exc:
                self.requests_today[model] = self.requests_today.get(model, 0) + 1
                self._record(
                    purpose, model, "error", getattr(exc, "usage", None), _ms(started), str(exc)[:300], job_id
                )
                errors.append(str(exc))
                continue
            self.requests_today[model] = self.requests_today.get(model, 0) + 1
            self._record(purpose, model, "ok", usage, _ms(started), job_id=job_id)
            return parsed
        raise QuotaExhausted("; ".join(errors) or "no model available")


def _ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)
