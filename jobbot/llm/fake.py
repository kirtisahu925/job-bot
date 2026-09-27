"""Deterministic offline provider for tests and dry runs: no network, no tokens spent.

Scores by keyword overlap and "tailors" by returning the profile's own bullets unchanged, which is
enough to exercise the full pipeline (render, lint, compile, store) end to end.
"""

from __future__ import annotations

import json
import re

from jobbot.llm.base import LLMError, RawUsage, T
from jobbot.scoring import ScoreBatch
from jobbot.tailor.schema import Bullet, Diagnostics, EntryRewrite, SkillRow, TailoredResume, Verification


def resume_from_profile(profile: dict, max_projects: int = 2) -> TailoredResume:
    return TailoredResume(
        diagnostics=Diagnostics(
            match_score=75, missing_keywords=[], red_flags=[], strong_sections=[], weak_sections=[]
        ),
        summary=" ".join(str(profile.get("summary", "")).split()),
        experience=[
            EntryRewrite(
                id=e["id"],
                bullets=[Bullet(text=b, impact_rank=i + 1) for i, b in enumerate(e.get("bullets") or [])],
            )
            for e in profile.get("experience") or []
        ],
        projects=[
            EntryRewrite(
                id=p["id"],
                bullets=[Bullet(text=b, impact_rank=i + 1) for i, b in enumerate(p.get("bullets") or [])],
            )
            for p in (profile.get("projects") or [])[:max_projects]
        ],
        skills=[SkillRow(category=k, items=list(v)) for k, v in (profile.get("skills") or {}).items()],
        verification=Verification(ats_parser="offline fake provider", hiring_manager="offline fake provider"),
    )


class FakeProvider:
    name = "fake"

    def __init__(self, fail_models: set[str] | None = None, rate_limit_models: set[str] | None = None):
        self.fail_models = fail_models or set()
        self.rate_limit_models = rate_limit_models or set()
        self.calls: list[tuple[str, str]] = []

    def generate(
        self, *, model: str, system: str, user: str, schema: type[T], max_output_tokens: int
    ) -> tuple[T, RawUsage]:
        from jobbot.llm.base import RateLimited

        self.calls.append((model, schema.__name__))
        if model in self.rate_limit_models:
            raise RateLimited(f"{model}: fake 429")
        if model in self.fail_models:
            raise LLMError(f"{model}: fake failure")
        usage = RawUsage(input_tokens=len(system + user) // 4, output_tokens=400, thinking_tokens=100)
        payload = json.loads(user)
        if schema is ScoreBatch:
            return self._score(payload), usage  # type: ignore[return-value]
        if schema is TailoredResume:
            if "previous" in payload:
                return TailoredResume.model_validate(payload["previous"]), usage  # type: ignore[return-value]
            return resume_from_profile(payload["profile"]), usage  # type: ignore[return-value]
        raise LLMError(f"fake provider cannot produce {schema.__name__}")

    @staticmethod
    def _score(payload: dict) -> ScoreBatch:
        skills = [s.lower() for items in (payload["candidate"].get("skills") or {}).values() for s in items]
        tracks = list(payload.get("tracks") or {"general": "General"})
        results = []
        for job in payload["jobs"]:
            text = f"{job['title']} {job['description']}".lower()
            hits = [s for s in skills if re.search(rf"(?<![a-z0-9]){re.escape(s)}(?![a-z0-9])", text)]
            track = next((t for t in tracks if t in job["title"].lower()), tracks[0])
            results.append(
                {
                    "job_id": job["job_id"],
                    "score": min(95, 40 + 8 * len(hits)),
                    "track": track,
                    "reason": f"{len(hits)} of your skills appear in the ad",
                    "missing_keywords": [],
                }
            )
        return ScoreBatch.model_validate({"results": results})
