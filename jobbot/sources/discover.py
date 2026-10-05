"""Finds the career boards of the companies on the dashboard's Companies page, so their openings are read
straight from the company (QuicklyHired's main source, and often earlier than job sites show them).

Each scan checks a few companies that have no board yet: a pasted careers link first (Greenhouse, Lever,
Ashby or Workday), then the company's name as a Greenhouse, Lever or Ashby board ("BrowserStack" ->
"browserstack"), then the known Workday sites in config/companies.yaml. A board counts only when it answers
with at least one job. Found boards are saved on the company; misses are checked again after two weeks."""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from jobbot.config import Settings

log = logging.getLogger(__name__)

RECHECK_DAYS = 14
PER_RUN = 8

_BOARD_URL = (
    (
        "greenhouse",
        re.compile(r"(?:job-boards|boards)(?:-api)?\.greenhouse\.io/(?:v1/boards/)?([\w-]+)", re.I),
    ),
    ("lever", re.compile(r"jobs\.lever\.co/([\w-]+)", re.I)),
    ("ashby", re.compile(r"jobs\.ashbyhq\.com/([\w.-]+)", re.I)),
    ("workday", re.compile(r"([\w-]+)\.(wd\d+)\.myworkdayjobs\.com/(?:[a-z]{2}-[A-Z]{2}/)?([\w-]+)", re.I)),
)


def board_from_url(url: str | None) -> tuple[str, str] | None:
    """("workday", "nvidia/wd5/NVIDIAExternalCareerSite") from a career page link, or None."""
    for board, pattern in _BOARD_URL:
        m = pattern.search(url or "")
        if m:
            return board, "/".join(m.groups()) if board == "workday" else m.group(1)
    return None


def slug_candidates(name: str) -> list[str]:
    """ "Walmart Global Tech" -> ["walmartglobaltech", "walmart-global-tech"]. Never just the first word:
    "American Express" must not land on another company's "american" board."""
    from jobbot.pipeline.filters import company_tokens

    words = [w for w in company_tokens(name) if w != "and"]  # no legal suffixes, no "&"
    out = ["".join(words), "-".join(words)]
    return [s for s in dict.fromkeys(out) if len(s) >= 3]


def _count(client: httpx.Client, board: str, slug: str) -> int:
    """Open jobs on this board, 0 if it does not exist or does not answer."""
    try:
        if board == "workday":
            tenant, dc, site = slug.split("/", 2)
            resp = client.post(
                f"https://{tenant}.{dc}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs",
                json={"appliedFacets": {}, "limit": 1, "offset": 0, "searchText": ""},
            )
            return int(resp.json().get("total") or 0) if resp.status_code == 200 else 0
        url = {
            "greenhouse": f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs",
            "lever": f"https://api.lever.co/v0/postings/{slug}?mode=json&limit=5",
            "ashby": f"https://api.ashbyhq.com/posting-api/job-board/{slug}",
        }[board]
        resp = client.get(url)
        if resp.status_code != 200:
            return 0
        data = resp.json()
        return len(data) if isinstance(data, list) else len(data.get("jobs") or [])
    except Exception as exc:  # noqa: BLE001 - a dead board is simply "not found"
        log.debug("board check %s/%s failed: %r", board, slug, exc)
        return 0


def find_board(
    client: httpx.Client, name: str, careers_url: str | None, workday_sites: dict[str, str]
) -> tuple[str, str] | None:
    pasted = board_from_url(careers_url)
    if pasted and _count(client, *pasted):
        return pasted
    for slug in slug_candidates(name):
        for board in ("greenhouse", "lever", "ashby"):
            if _count(client, board, slug):
                return board, slug
    known = next((v for k, v in workday_sites.items() if k.lower() == name.lower()), None)
    if known and _count(client, "workday", known):
        return "workday", known
    return None


def discover_boards(
    store, client: httpx.Client, settings: Settings, limit: int = PER_RUN
) -> list[dict[str, Any]]:
    """Look for the boards of a few companies without one; returns the boards found, ready to scan this run."""
    check = getattr(store, "companies_to_check", None)
    if not callable(check):
        return []
    try:
        rows = check(limit, datetime.now(UTC) - timedelta(days=RECHECK_DAYS))
    except Exception as exc:  # noqa: BLE001 - before migration 0012, or the store is down: scan anyway
        log.warning("company boards not checked: %r", exc)
        return []
    found: list[dict[str, Any]] = []
    for row in rows:
        hit = find_board(client, row["name"], row.get("careers_url"), settings.companies.workday_sites)
        fields: dict[str, Any] = {"board_checked_at": datetime.now(UTC).isoformat()}
        if hit:
            fields |= {"board": hit[0], "board_slug": hit[1]}
            found.append({"board": hit[0], "slug": hit[1], "name": row["name"]})
            log.info("career board found: %s -> %s %s", row["name"], *hit)
        store.update_company(row["id"], fields)
    return found
