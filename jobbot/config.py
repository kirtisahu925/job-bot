"""Loads the YAML config files, the master profile and secrets from the environment."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
PROMPTS_DIR = ROOT / "prompts"
TEMPLATES_DIR = ROOT / "templates"
PROFILE_PATH = ROOT / "profile" / "master_profile.yaml"
EXAMPLE_PROFILE_PATH = ROOT / "profile" / "master_profile.example.yaml"


class Track(BaseModel):
    label: str
    queries: list[str]
    keywords: list[str]


class Locations(BaseModel):
    cities: list[str]
    include_remote: bool = True
    remote_regions: list[str] = Field(default_factory=lambda: ["india", "anywhere", "worldwide"])
    aliases: dict[str, str] = Field(default_factory=dict)


class Limits(BaseModel):
    score_top_k: int = 30
    score_batch_size: int = 8
    tailor_per_run: int = 4
    min_score: int = 70
    max_revisions: int = 1
    board_max_age_days: int = 30


class SearchConfig(BaseModel):
    candidate: dict[str, Any] = Field(default_factory=dict)
    tracks: dict[str, Track]
    title_include: list[str]
    title_exclude: list[str]
    locations: Locations
    limits: Limits = Field(default_factory=Limits)
    sources: dict[str, dict[str, Any]] = Field(default_factory=dict)

    @property
    def max_required_years(self) -> int:
        return int(self.candidate.get("max_required_years", 4))

    def source(self, name: str) -> dict[str, Any]:
        return self.sources.get(name, {})

    def source_enabled(self, name: str) -> bool:
        return bool(self.source(name).get("enabled", False))


class ModelPrice(BaseModel):
    provider: str
    tier: str = "paid"
    input: float = 0.0
    output: float = 0.0
    cache_read: float | None = None
    daily_request_cap: int | None = None


class LLMChoice(BaseModel):
    provider: str = "gemini"
    score_models: list[str] = Field(default_factory=lambda: ["gemini-flash-lite-latest"])
    tailor_models: list[str] = Field(default_factory=lambda: ["gemini-flash-latest"])
    anthropic_score_model: str = "claude-haiku-4-5"
    anthropic_tailor_model: str = "claude-opus-5"


class PricingConfig(BaseModel):
    llm: LLMChoice = Field(default_factory=LLMChoice)
    models: dict[str, ModelPrice] = Field(default_factory=dict)
    shadow_model: str | None = None
    budgets: dict[str, dict[str, float]] = Field(default_factory=dict)
    fx_usd_inr: float = 88.0

    def price(self, model: str) -> ModelPrice | None:
        return self.models.get(model)

    def cost(self, model: str, input_tokens: int, output_tokens: int, cached_tokens: int = 0) -> float:
        p = self.price(model)
        if p is None:
            return 0.0
        return _cost(p, input_tokens, output_tokens, cached_tokens)

    def shadow_cost(self, input_tokens: int, output_tokens: int) -> float:
        if not self.shadow_model or self.shadow_model not in self.models:
            return 0.0
        return _cost(self.models[self.shadow_model], input_tokens, output_tokens, 0)


def _cost(p: ModelPrice, input_tokens: int, output_tokens: int, cached_tokens: int) -> float:
    cache_rate = p.cache_read if p.cache_read is not None else p.input
    uncached = max(input_tokens - cached_tokens, 0)
    return (uncached * p.input + cached_tokens * cache_rate + output_tokens * p.output) / 1_000_000


class Company(BaseModel):
    slug: str
    name: str


class CompaniesConfig(BaseModel):
    greenhouse: list[Company] = Field(default_factory=list)
    lever: list[Company] = Field(default_factory=list)
    ashby: list[Company] = Field(default_factory=list)


class Secrets(BaseModel):
    gemini_api_key: str | None = None
    anthropic_api_key: str | None = None
    anthropic_admin_key: str | None = None
    adzuna_app_id: str | None = None
    adzuna_app_key: str | None = None
    rapidapi_key: str | None = None
    jooble_api_key: str | None = None
    apify_token: str | None = None
    supabase_url: str | None = None
    supabase_service_role_key: str | None = None

    @classmethod
    def from_env(cls) -> Secrets:
        names = cls.model_fields.keys()
        return cls(**{n: (os.environ.get(n.upper()) or None) for n in names})


class Settings(BaseModel):
    search: SearchConfig
    pricing: PricingConfig
    companies: CompaniesConfig
    profile: dict[str, Any]
    secrets: Secrets


def _read_yaml(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_profile(path: Path | None = None) -> dict[str, Any]:
    """Profile source order: explicit path, MASTER_PROFILE_YAML env (CI secret), local file, example."""
    if path is not None:
        return _read_yaml(path)
    env = os.environ.get("MASTER_PROFILE_YAML")
    if env:
        return yaml.safe_load(env) or {}
    if PROFILE_PATH.exists():
        return _read_yaml(PROFILE_PATH)
    return _read_yaml(EXAMPLE_PROFILE_PATH)


def load_settings(config_dir: Path = CONFIG_DIR, profile_path: Path | None = None) -> Settings:
    return Settings(
        search=SearchConfig.model_validate(_read_yaml(config_dir / "search.yaml")),
        pricing=PricingConfig.model_validate(_read_yaml(config_dir / "pricing.yaml")),
        companies=CompaniesConfig.model_validate(_read_yaml(config_dir / "companies.yaml")),
        profile=load_profile(profile_path),
        secrets=Secrets.from_env(),
    )


def read_prompt(name: str) -> str:
    return (PROMPTS_DIR / name).read_text(encoding="utf-8")
