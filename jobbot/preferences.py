"""Your choices from the dashboard's Preferences and Settings pages (the single `user_settings` row in
Supabase), laid over config/*.yaml for one run. Anything left blank on the dashboard keeps the YAML value."""

from __future__ import annotations

import logging
import re
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from jobbot.config import Company, Settings
from jobbot.tailor.rounds import REVIEWERS

log = logging.getLogger(__name__)


class Preferences(BaseModel):
    # what you are aiming for: shapes the resume rounds
    target_level: str = ""  # e.g. "SDE-2"
    target_roles: list[str] = Field(default_factory=list)  # job titles: searched, and allowed as the headline
    emphasize: list[str] = Field(default_factory=list)  # e.g. "Java and Spring Boot", "system design"
    de_emphasize: list[str] = Field(default_factory=list)
    resume_notes: str = ""  # anything else the writer and reviewers should know
    # what the scans look for
    tracks: list[str] = Field(default_factory=list)  # keys of search.yaml tracks; empty = all of them
    cities: list[str] = Field(default_factory=list)  # empty = search.yaml's cities
    include_remote: bool | None = None
    max_required_years: int | None = None
    exclude_title_words: list[str] = Field(default_factory=list)  # added to search.yaml's title_exclude
    min_salary_lpa: float | None = None  # drop jobs whose stated INR salary tops out below this
    max_job_age_days: Literal[1, 3, 7, 30] | None = None  # only jobs posted within this many days
    # deal-breakers: dropped before any AI call
    skip_companies: list[str] = Field(default_factory=list)
    skip_phrases: list[str] = Field(default_factory=list)  # matched in the title and description
    skip_it_services: bool | None = None  # search.yaml's it_services list


class BotSettings(BaseModel):
    llm_provider: Literal["gemini", "anthropic"] | None = None
    claude_model: Literal["claude-opus-5-5", "claude-sonnet-5-5"] | None = None  # writes and reviews resumes
    ats_target: int | None = Field(None, ge=50, le=100)
    ats_minimum: int | None = Field(None, ge=0, le=100)
    reviewers: list[str] | None = None  # which review rounds run after the build
    fix_rounds: int | None = Field(None, ge=0, le=2)
    tailor_per_run: int | None = Field(None, ge=0, le=10)
    min_score: int | None = Field(None, ge=0, le=100)
    cover_letter: bool | None = None


def resume_preferences(p: Preferences) -> dict[str, Any]:
    """The part of your preferences the resume writer and reviewers see (blank ones left out)."""
    fields = ("target_level", "target_roles", "emphasize", "de_emphasize", "resume_notes")
    return {k: getattr(p, k) for k in fields if getattr(p, k)}


def _word(term: str) -> re.Pattern[str]:
    return re.compile(rf"(?<![a-z0-9]){re.escape(term.lower())}(?![a-z0-9])")


def _search_titles(settings: Settings, titles: list[str], note) -> None:
    """The job titles you want (e.g. "Full Stack Java Developer") are searched on every job site, pass the title
    filter even if a word in them is on the skip list, and may be used as your resume headline."""
    search = settings.search
    known = {q.lower() for q in search.extra_queries}
    search.extra_queries = [*search.extra_queries, *(t for t in titles if t.lower() not in known)]
    for title in titles:
        low = title.lower()
        if low not in search.title_include:
            search.title_include = [*search.title_include, low]
        freed = [w for w in search.title_exclude if _word(w).search(low)]
        if freed:
            search.title_exclude = [w for w in search.title_exclude if w not in freed]
            note(f"no longer skipping titles with ({title})", ", ".join(freed))
    allowed = settings.profile.setdefault("allowed_titles", [])
    allowed += [t for t in titles if t not in allowed]
    note("job titles searched", ", ".join(titles))


def apply_user_settings(settings: Settings, row: dict | None) -> list[str]:
    """Overlay the dashboard's choices onto `settings` in place. Returns one note per value it changed."""
    row = row or {}
    try:
        prefs = Preferences.model_validate(row.get("preferences") or {})
        bot = BotSettings.model_validate(row.get("settings") or {})
    except ValidationError as exc:
        msg = f"dashboard preferences ignored, they did not validate: {exc.errors()[:2]}"
        log.warning(msg)
        return [msg]
    search, notes = settings.search, []

    def note(what: str, value: Any) -> None:
        notes.append(f"{what}: {value}")

    if prefs.tracks:
        kept = {k: v for k, v in search.tracks.items() if k in prefs.tracks}
        if kept:
            search.tracks = kept
            note("tracks", ", ".join(kept))
    if prefs.cities:
        search.locations.cities = prefs.cities
        note("cities", ", ".join(prefs.cities))
    if prefs.include_remote is not None:
        search.locations.include_remote = prefs.include_remote
        note("remote jobs", prefs.include_remote)
    if prefs.max_required_years is not None:
        search.candidate["max_required_years"] = prefs.max_required_years
        note("max required years", prefs.max_required_years)
    extra = [w for w in prefs.exclude_title_words if w.strip() and w.lower() not in search.title_exclude]
    if extra:
        search.title_exclude = [*search.title_exclude, *(w.lower().strip() for w in extra)]
        note("extra excluded title words", ", ".join(extra))
    if prefs.min_salary_lpa is not None:
        search.candidate["min_salary_lpa"] = prefs.min_salary_lpa
        note("minimum salary (LPA)", prefs.min_salary_lpa)
    if prefs.max_job_age_days is not None:
        search.max_job_age_days = prefs.max_job_age_days
        days = prefs.max_job_age_days
        note("jobs posted within", "24 hours" if days == 1 else f"{days} days")
    companies = [c.strip() for c in prefs.skip_companies if c.strip()]
    if companies:
        search.skip_companies = companies
        note("companies skipped", ", ".join(companies))
    phrases = [p.strip() for p in prefs.skip_phrases if p.strip()]
    if phrases:
        search.skip_phrases = phrases
        note("jobs mentioning these skipped", ", ".join(phrases))
    if prefs.skip_it_services is not None:
        search.skip_it_services = prefs.skip_it_services
        note("IT-services companies skipped", prefs.skip_it_services)
    titles = list(dict.fromkeys(t.strip() for t in prefs.target_roles if t.strip()))
    if titles:
        _search_titles(settings, titles, note)
    search.preferences = resume_preferences(prefs)

    if bot.llm_provider == "anthropic" and not settings.secrets.anthropic_api_key:
        notes.append("Claude chosen on the dashboard, but ANTHROPIC_API_KEY is not set: using Gemini")
    elif bot.llm_provider:
        settings.pricing.llm.provider = bot.llm_provider
        note("AI provider", bot.llm_provider)
    if bot.claude_model:
        settings.pricing.llm.anthropic_tailor_model = bot.claude_model
        note("Claude model", bot.claude_model)
    if bot.ats_target is not None:
        search.ats.target = bot.ats_target
        note("ATS target", bot.ats_target)
    if bot.ats_minimum is not None:
        search.ats.minimum = min(bot.ats_minimum, search.ats.target)
        note("ATS minimum", search.ats.minimum)
    if bot.reviewers is not None:
        search.resume.reviewers = [r for r in bot.reviewers if r in REVIEWERS]
        note("review rounds", ", ".join(search.resume.reviewers) or "none")
    if bot.fix_rounds is not None:
        search.resume.fix_rounds = bot.fix_rounds
        note("fix-up rounds", bot.fix_rounds)
    if bot.tailor_per_run is not None:
        search.limits.tailor_per_run = bot.tailor_per_run
        note("resumes per scheduled run", bot.tailor_per_run)
    if bot.min_score is not None:
        search.limits.min_score = bot.min_score
        note("auto-tailor minimum match", bot.min_score)
    if bot.cover_letter is not None:
        search.cover_letter.enabled = bot.cover_letter
        note("cover letters", bot.cover_letter)
    return notes


def merge_company_boards(settings: Settings, boards: list[dict]) -> None:
    """Add the career boards from the Companies page to config/companies.yaml's lists (no duplicates)."""
    for b in boards:
        existing = getattr(settings.companies, b["board"], None)
        if existing is None or any(c.slug == b["slug"] for c in existing):
            continue
        existing.append(Company(slug=b["slug"], name=b["name"]))
