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


class Source(ABC):
    name: str

    def run(self) -> SourceResult:
        """Fetch without ever raising: failures become a status on the result."""
        try:
            return self.fetch()
        except Exception as exc:  # noqa: BLE001 - isolation is the point
            log.warning("source %s failed: %s", self.name, exc)
            return SourceResult(source=self.name, status=status_of(exc), error=str(exc)[:500])

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
    queries = [q for t in cfg.tracks.values() for q in t.queries[:1]]  # one query per track per site
    all_queries = [q for t in cfg.tracks.values() for q in t.queries]
    month = calls_this_month or (lambda _src: 0)
    today = calls_today or (lambda _src: 0)
    max_age = cfg.limits.board_max_age_days

    candidates: list[Source] = []
    for site in ("linkedin", "indeed", "naukri", "foundit", "wellfound"):
        conf = cfg.source(site)
        if not conf.get("enabled"):
            continue
        method = conf.get("method", "native")
        if method == "jobspy":
            candidates.append(JobSpySource(site, queries, conf))
        elif method == "apify":
            candidates.append(ApifySource(site, client, s.apify_token, conf, conf.get("queries") or queries))
        elif site == "foundit":
            candidates.append(FounditSource(client, queries, conf))
    if cfg.source_enabled("adzuna"):
        candidates.append(
            AdzunaSource(client, s.adzuna_app_id, s.adzuna_app_key, queries, cfg.source("adzuna"), today)
        )
    if cfg.source_enabled("jsearch"):
        candidates.append(JSearchSource(client, s.rapidapi_key, queries, cfg.source("jsearch"), month))
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

    if only:
        wanted = set(only)
        candidates = [c for c in candidates if c.name in wanted]
    return candidates
