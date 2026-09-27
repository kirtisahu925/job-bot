"""One balance snapshot per provider per run: money used and left, or quota used and left.

Sources of truth, best first: the provider's own API (Apify limits, RapidAPI headers), then our ledger,
then credit top-ups entered on the dashboard for providers that expose no balance API (Anthropic).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

import httpx

from jobbot.config import Settings
from jobbot.llm.ledger import month_start, quota_day_start
from jobbot.models import BalanceSnapshot, SourceResult
from jobbot.sources.apify import account_limits

log = logging.getLogger(__name__)


def _dt(value) -> datetime:
    return value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def llm_quota_snapshots(settings: Settings, store, now: datetime) -> list[BalanceSnapshot]:
    requests = store.llm_requests_since(quota_day_start(now))
    active = set(settings.pricing.llm.score_models + settings.pricing.llm.tailor_models)
    out = []
    for model, price in settings.pricing.models.items():
        cap = price.daily_request_cap
        if cap is None or (model not in active and not requests.get(model)):
            continue
        used = requests.get(model, 0)
        out.append(
            BalanceSnapshot(
                provider=f"{price.provider}:{model}",
                kind="quota",
                unit="requests",
                used=used,
                limit=cap,
                remaining=max(cap - used, 0),
                period="day",
                method="ledger",
                note="free tier; resets at midnight Pacific",
            )
        )
    return out


def paid_llm_snapshots(settings: Settings, store, now: datetime) -> list[BalanceSnapshot]:
    out = []
    paid = {p.provider for p in settings.pricing.models.values() if p.tier == "paid"}
    for provider in sorted(paid):
        spent_month = store.llm_cost_since(provider, month_start(now))
        topups = store.topups(provider)
        budget = settings.pricing.budgets.get(provider, {}).get("monthly_budget_usd")
        if not topups and not spent_month and settings.pricing.llm.provider != provider:
            continue
        if budget is not None:
            out.append(
                BalanceSnapshot(
                    provider=provider,
                    kind="money",
                    unit="USD",
                    used=round(spent_month, 4),
                    limit=budget,
                    remaining=round(max(budget - spent_month, 0), 4),
                    period="month",
                    method="ledger",
                    note="monthly budget from config/pricing.yaml",
                )
            )
        if topups:
            first = min(_dt(t["purchased_at"]) for t in topups)
            credit = sum(float(t["amount_usd"]) for t in topups)
            spent = store.llm_cost_since(provider, first)
            out.append(
                BalanceSnapshot(
                    provider=f"{provider}:credit",
                    kind="money",
                    unit="USD",
                    used=round(spent, 4),
                    limit=credit,
                    remaining=round(credit - spent, 4),
                    period="lifetime",
                    method="manual",
                    note="top-ups entered on the dashboard minus recorded spend",
                )
            )
    return out


def apify_snapshot(settings: Settings, store, client: httpx.Client, now: datetime) -> BalanceSnapshot | None:
    uses_apify = [
        n for n, c in settings.search.sources.items() if c.get("enabled") and c.get("method") == "apify"
    ]
    if not uses_apify:
        return None
    free = settings.pricing.budgets.get("apify", {}).get("free_monthly_credit_usd", 5.0)
    token = settings.secrets.apify_token
    if token:
        try:
            data = account_limits(client, token)
            used = float((data.get("current") or {}).get("monthlyUsageUsd") or 0.0)
            limit = float((data.get("limits") or {}).get("maxMonthlyUsageUsd") or free)
            return BalanceSnapshot(
                provider="apify",
                kind="money",
                unit="USD",
                used=round(used, 4),
                limit=limit,
                remaining=round(max(limit - used, 0), 4),
                period="month",
                method="live_api",
                note="from Apify /users/me/limits",
            )
        except Exception as exc:  # noqa: BLE001 - fall back to our own ledger
            log.warning("apify limits unavailable: %s", exc)
    used = sum(store.api_cost_since(name, month_start(now)) for name in uses_apify)
    return BalanceSnapshot(
        provider="apify",
        kind="money",
        unit="USD",
        used=round(used, 4),
        limit=free,
        remaining=round(max(free - used, 0), 4),
        period="month",
        method="ledger",
        note="estimated from recorded actor runs",
    )


def source_quota_snapshots(
    settings: Settings, store, results: list[SourceResult], now: datetime
) -> list[BalanceSnapshot]:
    out = []
    by_name = {r.source: r for r in results}
    cfg = settings.search
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if cfg.source_enabled("jsearch"):
        cap = int(cfg.source("jsearch").get("monthly_cap", 190))
        used = store.api_calls_since("jsearch", month_start(now))
        live = by_name.get("jsearch")
        remaining = live.remaining if live and live.remaining is not None else max(cap - used, 0)
        out.append(
            BalanceSnapshot(
                provider="jsearch",
                kind="quota",
                unit="requests",
                used=used,
                limit=cap,
                remaining=remaining,
                period="month",
                method="live_api" if live and live.remaining is not None else "ledger",
                note="RapidAPI Basic plan",
            )
        )
    for name in ("adzuna", "jooble"):
        if cfg.source_enabled(name):
            cap = int(cfg.source(name).get("daily_cap", 100))
            used = store.api_calls_since(name, day)
            out.append(
                BalanceSnapshot(
                    provider=name,
                    kind="quota",
                    unit="calls",
                    used=used,
                    limit=cap,
                    remaining=max(cap - used, 0),
                    period="day",
                    method="ledger",
                )
            )
    return out


def collect(
    settings: Settings, store, client: httpx.Client, results: list[SourceResult], now: datetime | None = None
) -> list[BalanceSnapshot]:
    now = now or datetime.now(UTC)
    snaps = llm_quota_snapshots(settings, store, now) + paid_llm_snapshots(settings, store, now)
    apify = apify_snapshot(settings, store, client, now)
    if apify:
        snaps.append(apify)
    return snaps + source_quota_snapshots(settings, store, results, now)
