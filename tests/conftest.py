from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from jobbot.config import EXAMPLE_PROFILE_PATH, load_profile, load_settings

FIXTURES = Path(__file__).parent / "fixtures"


def fixture_json(name: str):
    return json.loads((FIXTURES / name).read_text())


@pytest.fixture
def settings(monkeypatch):
    for var in ("MASTER_PROFILE_YAML", "APIFY_TOKEN", "RAPIDAPI_KEY", "ADZUNA_APP_ID", "ADZUNA_APP_KEY"):
        monkeypatch.delenv(var, raising=False)
    s = load_settings(profile_path=EXAMPLE_PROFILE_PATH)
    return s


@pytest.fixture
def profile():
    return load_profile(EXAMPLE_PROFILE_PATH)


def has_tex() -> bool:
    return bool(shutil.which("pdflatex") or shutil.which("tectonic"))


requires_tex = pytest.mark.skipif(not has_tex(), reason="no LaTeX engine on PATH")
