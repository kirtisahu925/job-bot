"""A short cover letter per tailored resume (the career-ops idea), written from the resume's own text.

It uses the cheap scoring model (one call), and the same honesty rule as the resume: any sentence that
cites a number or a tool the resume and profile never mention is removed before the letter is saved.
"""

from __future__ import annotations

import json
import re

from pydantic import BaseModel, Field

from jobbot.ats.skills import _synonyms, in_text, normalize_text, profile_vocabulary
from jobbot.config import read_prompt
from jobbot.llm.ledger import Ledger
from jobbot.models import Job
from jobbot.tailor.facts import AMBIGUOUS, INTENSIFIERS, numbers

SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-Z])")


class CoverLetter(BaseModel):
    text: str = Field(description="the letter: greeting line, three short paragraphs, sign-off")


def _terms(profile: dict, extra: list[str]) -> list[str]:
    return sorted({*_synonyms()[1].keys(), *profile_vocabulary(profile), *extra}, key=len, reverse=True)


def check_letter(text: str, source: str, terms: list[str]) -> tuple[str, list[str]]:
    """The letter with unsupported sentences removed, and why each was removed. Line breaks (greeting,
    sign-off) and blank lines between paragraphs are kept."""
    src_norm = normalize_text(source)
    src_numbers = numbers(source)
    removed: list[str] = []

    def keep(sentence: str) -> bool:
        bad_numbers = numbers(sentence) - src_numbers
        norm = normalize_text(sentence)
        bad_terms = [
            t for t in terms if t.lower() not in AMBIGUOUS and in_text(t, norm) and not in_text(t, src_norm)
        ]
        vague = [w for w in INTENSIFIERS if re.search(rf"\b{re.escape(w)}\b", sentence.lower())]
        placeholder = "\u2014" in sentence or re.search(r"\[[^\]]+\]", sentence)
        if bad_numbers or bad_terms or vague or placeholder:
            why = ", ".join([*sorted(bad_numbers), *bad_terms, *vague]) or "a placeholder or an em dash"
            removed.append(f"removed a sentence citing {why}: {sentence[:80]}")
            return False
        return True

    paragraphs = []
    for para in re.split(r"\n\s*\n", text.strip()):
        lines = []
        for line in para.splitlines():
            kept = [s for s in SENTENCE.split(line.strip()) if s and keep(s)]
            if kept:
                lines.append(" ".join(kept))
        if lines:
            paragraphs.append("\n".join(lines))
    return "\n\n".join(paragraphs), removed


def write_cover_letter(
    job: Job,
    profile: dict,
    resume_text: str,
    ledger: Ledger,
    models: list[str],
    gaps: list[str] | None = None,
) -> tuple[str, list[str]]:
    name = (profile.get("contact") or {}).get("name", "")
    payload = {
        "name": name,
        "job": {"title": job.title, "company": job.company, "description": (job.description or "")[:6000]},
        "resume": resume_text[:8000],
        "profile": {k: profile.get(k) for k in ("headline", "summary", "years_experience", "skills")},
        "gaps": gaps or [],
    }
    letter = ledger.call(
        purpose="cover_letter",
        models=models,
        system=read_prompt("cover_letter.md"),
        user=json.dumps(payload, ensure_ascii=False, indent=1),
        schema=CoverLetter,
        max_output_tokens=2048,
        job_id=job.id,
    )
    source = (
        resume_text + "\n" + json.dumps(profile, ensure_ascii=False) + "\n" + job.company + " " + job.title
    )
    return check_letter(letter.text, source, _terms(profile, gaps or []))
