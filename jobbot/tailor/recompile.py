"""Resumes you edit by hand on the dashboard (the LaTeX editor on a job's page): compile the edited source, score
it like any other resume, and save it as the job's newest resume. No LLM calls; the edit is yours, so it is not
fact-checked, but it is compiled with shell escape off and must still compile."""

from __future__ import annotations

import logging
from typing import Any

from jobbot.ats.score import JDKeywords
from jobbot.ats.score import compute as ats_compute
from jobbot.config import Settings, load_own_resume
from jobbot.tailor.compile import CompileError, compile_tex
from jobbot.tailor.generate import pdf_text
from jobbot.tailor.own_resume import page_count

log = logging.getLogger(__name__)

EDIT_ROUND = {
    "name": "edit",
    "title": "Your edit",
    "analysis": None,
    "review": None,
    "problems": [],
    "skipped": None,
    "kept": True,
}


def _record(base: dict, pages: int, ats) -> dict[str, Any]:
    """The new tailoring: the edited PDF with the base version's analysis, reviews and cover letter kept."""
    rounds = [r | {"kept": False} for r in (base.get("rounds") or [])]
    rounds.append(EDIT_ROUND | {"ats_score": ats.score if ats else None})
    issues = (
        []
        if pages == 1
        else [
            {"code": "pages", "where": "document", "message": f"runs to {pages} pages", "llm_fixable": False}
        ]
    )
    return {
        "status": "ok" if pages == 1 else "needs_review",
        "diagnostics": base.get("diagnostics"),
        "verification": base.get("verification"),
        "content": base.get("content"),
        "lint_issues": issues,
        "fixes": ["Edited by hand on the dashboard and recompiled"],
        "revisions": 0,
        "pages": pages,
        "fill_ratio": None,
        "layout_level": None,
        "ats_score": ats.score if ats else None,
        "ats": (ats.model_dump() | {"rounds": [ats.score]}) if ats else None,
        "rounds": rounds,
        "cover_letter": base.get("cover_letter"),
        "provider": "manual",
        "model": None,
    }


def process_edit(settings: Settings, store, edit: dict, engine: str) -> dict[str, Any]:
    """Compile one queued edit. Returns {"edit_id", "status", "error" | "tailoring_id", "ats_score"}.
    Any failure ends as "failed" with a reason, so the editor never waits on an edit stuck at "compiling"."""
    edit_id = edit["id"]
    try:
        return _process(settings, store, edit, engine)
    except Exception as exc:  # noqa: BLE001 - reported on the edit, which is what the editor shows
        log.exception("edit %s failed", edit_id)
        error = (
            f"The edit could not be saved ({type(exc).__name__}: {str(exc)[:400]}). Compile again to retry."
        )
        try:
            store.update_edit(edit_id, {"status": "failed", "error": error})
        except Exception:  # noqa: BLE001
            log.exception("edit %s: could not record the failure", edit_id)
        return {"edit_id": edit_id, "status": "failed", "error": error}


def _process(settings: Settings, store, edit: dict, engine: str) -> dict[str, Any]:
    edit_id = edit["id"]
    store.update_edit(edit_id, {"status": "compiling"})
    job = store.get_job(edit["job_id"])
    if job is None:
        store.update_edit(edit_id, {"status": "failed", "error": "The job was deleted."})
        return {"edit_id": edit_id, "status": "failed", "error": "job deleted"}
    base = store.get_tailoring(edit["base_tailoring_id"]) if edit.get("base_tailoring_id") else {}
    own = load_own_resume()
    try:
        pdf = compile_tex(edit["tex"], engine, own[1] if own else None)
    except CompileError as exc:
        error = str(exc)[-2000:]
        store.update_edit(edit_id, {"status": "failed", "error": error})
        return {"edit_id": edit_id, "status": "failed", "error": error}

    pages = page_count(pdf)
    text = pdf_text(pdf)
    ats = None
    if job.jd_keywords:
        email = (settings.profile.get("contact") or {}).get("email", "")
        ats = ats_compute(
            resume_text=text,
            body_text=text,
            headline=text[:200],
            jd=JDKeywords.model_validate(job.jd_keywords),
            job_title=job.title,
            jd_min_years=job.min_years,
            profile=settings.profile,
            known_skills=store.known_skills(),
            format_checks={
                "one page": pages == 1,
                "standard headings": all(
                    h.lower() in text.lower() for h in ("Experience", "Education", "Skills")
                ),
                "contact readable": bool(email) and email in text,
                "clean text extraction": "(cid:" not in text,
            },
            target=settings.search.ats.target,
        )
    saved = store.save_tailoring(job.id, _record(base or {}, pages, ats), edit["tex"].encode(), pdf)
    store.update_job(job.id, {"ats_score": ats.score if ats else None})
    store.update_edit(edit_id, {"status": "done", "result_tailoring_id": saved.get("id"), "error": None})
    return {
        "edit_id": edit_id,
        "status": "done",
        "tailoring_id": saved.get("id"),
        "ats_score": ats.score if ats else None,
    }


def process_edits(
    settings: Settings, store, engine: str | None, edit_ids: list[str] | None = None
) -> list[dict]:
    """The given edits, or every queued one (the scheduled scan picks up edits Tailor now could not start)."""
    if engine is None:
        return []
    try:
        edits = store.resume_edits(edit_ids)
    except Exception as exc:  # noqa: BLE001 - before migration 0009 there is no table; never block a scan
        log.warning("resume edits not read: %r", exc)
        return []
    return [process_edit(settings, store, e, engine) for e in edits]
