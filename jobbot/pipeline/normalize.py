"""Turns RawJob records into normalized Jobs: clean text, canonical URLs, city, fingerprint."""

from __future__ import annotations

import hashlib
import html
import re
from datetime import UTC, date, datetime
from typing import Any
from urllib.parse import parse_qs, urlparse

from bs4 import BeautifulSoup

from jobbot.config import Locations
from jobbot.models import Job, JobLink, RawJob

# Lower number = preferred apply link (company ATS beats job boards).
SOURCE_PRIORITY = {
    "greenhouse": 0,
    "lever": 0,
    "ashby": 0,
    "extension": 1,
    "wellfound": 2,
    "linkedin": 3,
    "naukri": 3,
    "indeed": 3,
    "foundit": 3,
    "remotive": 4,
    "jsearch": 4,
    "adzuna": 5,
    "jooble": 5,
}

_COMPANY_SUFFIXES = re.compile(
    r"\b(private|pvt|limited|ltd|llp|inc|incorporated|corp|corporation|co|company|india|technologies|"
    r"technology|solutions|software|services|labs)\b"
)
_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_REMOTE = re.compile(r"\b(remote|work from home|wfh|anywhere)\b", re.I)
_MD_ESCAPES = re.compile(r"\\([\\`*_{}\[\]()#+\-.!|>])")


def html_to_text(value: str | None) -> str:
    if not value:
        return ""
    text = html.unescape(value)
    if "<" in text and ">" in text:
        text = BeautifulSoup(text, "html.parser").get_text("\n")
    text = _MD_ESCAPES.sub(r"\1", text)
    text = text.replace("**", "").replace("\r", "")
    lines = [re.sub(r"[ \t ]+", " ", line).strip() for line in text.split("\n")]
    out: list[str] = []
    for line in lines:
        if line or (out and out[-1]):
            out.append(line)
    return "\n".join(out).strip()


def parse_dt(value: Any) -> datetime | None:
    """Accepts ISO strings, epoch seconds/ms, date/datetime and pandas Timestamps."""
    if value is None or value == "":
        return None
    try:
        import math

        if isinstance(value, float) and math.isnan(value):
            return None
    except Exception:  # pragma: no cover
        pass
    if hasattr(value, "to_pydatetime"):
        value = value.to_pydatetime()
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=UTC)
    if isinstance(value, (int, float)):
        seconds = value / 1000 if value > 10_000_000_000 else value
        return datetime.fromtimestamp(seconds, tz=UTC)
    if isinstance(value, str):
        s = value.strip()
        if s.isdigit():
            return parse_dt(int(s))
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
        except ValueError:
            return None
    return None


def url_key(url: str) -> str:
    """Canonical id for a posting URL so the same job matches across visits and sites.

    Mirrored in extension/lib/urlkey.js; tests/fixtures/url_keys.json covers both.
    """
    if not url:
        return ""
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower().removeprefix("www.").removeprefix("m.")
    path = parsed.path.rstrip("/")
    query = parse_qs(parsed.query)

    if host.endswith("linkedin.com"):
        if "currentJobId" in query:
            return f"linkedin:{query['currentJobId'][0]}"
        m = re.search(r"/jobs/view/(?:[^/]*?-)?(\d+)", path)
        if m:
            return f"linkedin:{m.group(1)}"
    if host.endswith("indeed.com") or ".indeed." in f".{host}":
        for key in ("jk", "vjk"):
            if key in query:
                return f"indeed:{query[key][0]}"
    if host.endswith("naukri.com"):
        m = re.search(r"-(\d{6,})$", path)
        if m:
            return f"naukri:{m.group(1)}"
    if host.endswith("foundit.in") or host.endswith("foundit.com"):
        m = re.search(r"-(\d{5,})$", path) or re.search(r"/(\d{5,})(?:/|$)", path)
        if m:
            return f"foundit:{m.group(1)}"
    if host.endswith("wellfound.com") or host.endswith("angel.co"):
        m = re.search(r"/jobs/(\d+)", path)
        if m:
            return f"wellfound:{m.group(1)}"
    if "greenhouse.io" in host:
        if "gh_jid" in query:
            return f"greenhouse:{query['gh_jid'][0]}"
        m = re.search(r"/jobs/(\d+)", path)
        if m:
            return f"greenhouse:{m.group(1)}"
    if "gh_jid" in query:
        return f"greenhouse:{query['gh_jid'][0]}"
    if host == "jobs.lever.co":
        m = re.search(r"^/[^/]+/([0-9a-f-]{36})", path)
        if m:
            return f"lever:{m.group(1)}"
    if host == "jobs.ashbyhq.com":
        m = re.search(r"^/[^/]+/([0-9a-f-]{36})", path)
        if m:
            return f"ashby:{m.group(1)}"
    return f"{host}{path}"


def _norm(text: str) -> str:
    return _NON_ALNUM.sub(" ", text.lower()).strip()


def norm_company(name: str) -> str:
    base = _norm(name)
    stripped = re.sub(r"\s+", " ", _COMPANY_SUFFIXES.sub(" ", base)).strip()
    return stripped or base


def norm_title(title: str) -> str:
    t = title.lower()
    t = re.sub(r"\b(sde|software development engineer)\s*-?\s*(ii|2)\b", "sde 2", t)
    t = re.sub(r"\b(sde|software development engineer)\s*-?\s*(i|1)\b", "sde 1", t)
    return re.sub(r"\s+", " ", _norm(t)).strip()


def detect_city(location: str, locations: Locations) -> str | None:
    loc = f" {_norm(location)} "
    aliases = {
        **{c.lower(): c for c in locations.cities},
        **{k.lower(): v for k, v in locations.aliases.items()},
    }
    # First city named wins ("Bengaluru, Hyderabad" -> Bengaluru); on a tie the longer alias wins,
    # so "greater noida" beats "noida" and "new delhi" beats "delhi".
    best: tuple[int, int, str] | None = None
    for alias, city in aliases.items():
        pos = loc.find(f" {_norm(alias)} ")
        if pos >= 0:
            cand = (pos, -len(alias), city)
            if best is None or cand < best:
                best = cand
    return best[2] if best else None


def is_remote(raw: RawJob) -> bool:
    return raw.remote or bool(_REMOTE.search(raw.location or "")) or bool(_REMOTE.search(raw.title or ""))


def fingerprint(company: str, title: str, place: str) -> str:
    key = f"{norm_company(company)}|{norm_title(title)}|{_norm(place)}"
    return hashlib.sha1(key.encode()).hexdigest()


def normalize(raw: RawJob, locations: Locations) -> Job:
    description = html_to_text(raw.description)
    remote = is_remote(raw)
    city = detect_city(raw.location, locations)
    place = city or ("remote" if remote else (raw.location.split(",")[0] if raw.location else ""))
    apply_url = raw.apply_url or raw.url
    return Job(
        fingerprint=fingerprint(raw.company, raw.title, place),
        title=raw.title.strip(),
        company=raw.company.strip(),
        location=raw.location.strip(),
        city=city,
        remote=remote,
        apply_url=apply_url,
        description=description,
        salary_min=raw.salary_min,
        salary_max=raw.salary_max,
        currency=raw.currency,
        posted_at=raw.posted_at,
        remote_region=raw.remote_region,
        experience_text=raw.experience_text,
        job_type=raw.job_type,
        links=[
            JobLink(source=raw.source, url=raw.url, url_key=url_key(raw.url), source_job_id=raw.source_job_id)
        ]
        + (
            [JobLink(source=raw.source, url=raw.apply_url, url_key=url_key(raw.apply_url))]
            if raw.apply_url and url_key(raw.apply_url) != url_key(raw.url)
            else []
        ),
        min_years=None,
    )


def _apply_rank(job: Job) -> int:
    ranks = [SOURCE_PRIORITY.get(link.source, 9) for link in job.links if link.url == job.apply_url]
    return min(ranks) if ranks else 9


def merge(jobs: list[Job]) -> list[Job]:
    """Collapse the same posting seen on several sites (same fingerprint or same URL key)."""
    by_fp: dict[str, Job] = {}
    by_key: dict[str, str] = {}
    for job in jobs:
        existing_fp = by_fp.get(job.fingerprint) and job.fingerprint
        if not existing_fp:
            existing_fp = next((by_key[link.url_key] for link in job.links if link.url_key in by_key), None)
        if not existing_fp:
            by_fp[job.fingerprint] = job
            for link in job.links:
                by_key[link.url_key] = job.fingerprint
            continue
        base = by_fp[existing_fp]
        known = {link.url_key for link in base.links}
        for link in job.links:
            if link.url_key not in known:
                base.links.append(link)
                known.add(link.url_key)
                by_key[link.url_key] = base.fingerprint
        if len(job.description) > len(base.description):
            base.description = job.description
        if _apply_rank(job) < _apply_rank(base):
            base.apply_url = job.apply_url
        base.posted_at = base.posted_at or job.posted_at
        base.salary_min = base.salary_min or job.salary_min
        base.salary_max = base.salary_max or job.salary_max
        base.city = base.city or job.city
        base.experience_text = base.experience_text or job.experience_text
        types = [t for t in (base.job_type, job.job_type) if t]
        base.job_type = ", ".join(dict.fromkeys(types)) or None  # any site calling it an internship counts
    return list(by_fp.values())
