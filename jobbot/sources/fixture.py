"""Offline source that replays RawJobs from a JSON file; used for dry runs and tests."""

from __future__ import annotations

import json
from pathlib import Path

from jobbot.models import RawJob, SourceResult
from jobbot.sources.base import Source


class FixtureSource(Source):
    def __init__(self, path: Path, name: str = "fixture"):
        self.path = path
        self.name = name

    def fetch(self) -> SourceResult:
        data = json.loads(self.path.read_text(encoding="utf-8"))
        jobs = [RawJob.model_validate(item) for item in data]
        return SourceResult(source=self.name, calls=1, jobs=jobs)
