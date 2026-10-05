"""Source interface, the concurrent runner and the factory that builds enabled sources from config."""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, wait

import httpx

from jobbot.config import Settings
from jobbot.http import status_of
from jobbot.models import SourceResult

log = logging.getLogger(__name__)


def describe(exc: BaseException) -> str:
    """Short failure text; for HTTP errors, the status, the path and what the server said."""
    if isinstance(exc, httpx.HTTPStatusError):
        resp = exc.response
        body = " ".join(resp.text.split())[:240]
        return f"HTTP {resp.status_code} from {resp.request.url.host}{resp.request.url.path}: {body or '(empty body)'}"
    return str(exc)


class Source(ABC):
    name: str

    def run(self) -> SourceResult:
        """Fetch without ever raising: failures become a status on the result."""
        try:
            return self.fetch()
        except Exception as exc:  # noqa: BLE001 - isolation is the point
            error = describe(exc)
            log.warning("source %s failed: %s", self.name, error)
            return SourceResult(source=self.name, status=status_of(exc), error=error[:500])

    @abstractmethod
    def fetch(self) -> SourceResult: ...


def run_sources(sources: list[Source], timeout_s: float = 420) -> list[SourceResult]:
    """Run all sources concurrently; a source that overruns is reported as a timeout."""
    if not sources:
        return []
    pool = ThreadPoolExecutor(max_workers=min(8, len(sources)), thread_name_prefix="source")
    futures = {pool.submit(s.run): s for s in sources}
    done, not_done = wait(futures, timeout=timeout_s)
    results: list[SourceResult] = []
    for fut in done:
        results.append(fut.result())
    for fut in not_done:
        fut.cancel()
        results.append(
            SourceResult(source=futures[fut].name, status="timeout", error=f"exceeded {timeout_s}s")
        )
    pool.shutdown(wait=False, cancel_futures=True)
    order = {s.name: i for i, s in enumerate(sources)}
    return sorted(results, key=lambda r: order.get(r.source, 99))


# JSearch's date_posted values for the Preferences choices
JSEARCH_DATE_POSTED = {1: "today", 3: "3days", 7: "week", 30: "month"}


def build_sources(
    settings: Settings,
    client: httpx.Client,
    only: list[str] | None = None,
    calls_this_month: Callable[[str], int] | None = None,
    calls_today: Callable[[str], int] | None = None,
) -> list[Source]:
    from jobbot.sources.apify import ApifySource
    from jobbot.sources.boards import AshbySource, GreenhouseSource, LeverSource
    from jobbot.sources.feeds import AdzunaSource, JoobleSource, JSearchSource, RemotiveSource
    from jobbot.sources.foundit import FounditSource
    from jobbot.sources.jobspy_sites import JobSpySource

    cfg = settings.search
    s = settings.secrets

    def with_titles(base: list[str]) -> list[str]:
        """The job titles from your Preferences are searched on every site, after the configured queries."""
        return list(dict.fromkeys([*base, *cfg.extra_queries]))

    queries = with_titles(
        [q for t in cfg.tracks.values() for q in t.queries[:1]]
    )  # one query per track per site
    all_queries = with_titles([q for t in cfg.tracks.values() for q in t.queries])
    month = calls_this_month or (lambda _src: 0)
    today = calls_today or (lambda _src: 0)
    # the job age from Preferences replaces each site's own date filter; sites without one are filtered later
    age = cfg.max_job_age_days
    max_age = age or cfg.limits.board_max_age_days

    def dated(conf: dict, **window) -> dict:
        return {**conf, **window} if age else conf

    candidates: list[Source] = []
    for site in ("linkedin", "indeed", "naukri", "foundit", "wellfound"):
        conf = cfg.source(site)
        if not conf.get("enabled"):
            continue
        method = conf.get("method", "native")
        if method == "jobspy":
            candidates.append(
                JobSpySource(
                    site, with_titles(conf.get("queries") or queries), dated(conf, hours_old=(age or 0) * 24)
                )
            )
        elif method == "apify":
            candidates.append(
                ApifySource(site, client, s.apify_token, conf, with_titles(conf.get("queries") or queries))
            )
        elif site == "foundit":
            candidates.append(FounditSource(client, queries, conf))
    if cfg.source_enabled("adzuna"):
        candidates.append(
            AdzunaSource(
                client,
                s.adzuna_app_id,
                s.adzuna_app_key,
                queries,
                dated(cfg.source("adzuna"), max_days_old=age),
                today,
            )
        )
    if cfg.source_enabled("jsearch"):
        conf = dated(cfg.source("jsearch"), date_posted=JSEARCH_DATE_POSTED.get(age or 0, "month"))
        candidates.append(JSearchSource(client, s.rapidapi_key, queries, conf, month))
    if cfg.source_enabled("jooble"):
        candidates.append(JoobleSource(client, s.jooble_api_key, queries, cfg.source("jooble"), today))
    if cfg.source_enabled("remotive"):
        candidates.append(RemotiveSource(client, all_queries))
    if cfg.source_enabled("boards"):
        if settings.companies.greenhouse:
            candidates.append(GreenhouseSource(client, settings.companies.greenhouse, max_age))
        if settings.companies.lever:
            candidates.append(LeverSource(client, settings.companies.lever, max_age))
        if settings.companies.ashby:
            candidates.append(AshbySource(client, settings.companies.ashby, max_age))
        if settings.companies.workday:
            from jobbot.sources.workday import WorkdaySource

            candidates.append(WorkdaySource(client, settings.companies.workday, max_age, queries))

    if only:
        wanted = set(only)
        candidates = [c for c in candidates if c.name in wanted]
    return candidates
