"""Job sources. Each returns a SourceResult and never raises, so one broken site cannot stop a run."""

from __future__ import annotations

from jobbot.sources.base import Source, build_sources

__all__ = ["Source", "build_sources"]
