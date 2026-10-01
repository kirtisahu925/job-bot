from pathlib import Path

from jobbot.llm.fake import resume_from_profile
from jobbot.models import Job
from jobbot.tailor.compile import compile_tex, find_engine
from jobbot.tailor.latex import Layout, render
from jobbot.tailor.recompile import process_edit
from tests.conftest import requires_tex


class EditStore:
    """Just what recompiling an edit touches."""

    def __init__(self, job: Job, base: dict):
        self.job, self.base = job, base
        self.saved: list[dict] = []
        self.edit_updates: list[dict] = []
        self.job_updates: list[dict] = []

    def get_job(self, job_id):
        return self.job if job_id == self.job.id else None

    def get_tailoring(self, tailoring_id):
        return self.base

    def known_skills(self):
        return []

    def save_tailoring(self, job_id, record, tex, pdf):
        self.saved.append(record)
        return {"id": "t-new"}

    def update_job(self, job_id, fields):
        self.job_updates.append(fields)

    def update_edit(self, edit_id, fields):
        self.edit_updates.append(fields)


def _job():
    return Job(
        id="j1",
        fingerprint="f",
        title="Backend Engineer",
        company="Acme",
        apply_url="u",
        description="Java",
        jd_keywords={"required": ["Java"], "preferred": []},
    )


BASE = {
    "diagnostics": {"match_score": 80},
    "cover_letter": "Dear team",
    "rounds": [{"name": "build", "title": "Build", "ats_score": 70, "kept": True}],
}


@requires_tex
def test_an_edit_compiles_scores_and_becomes_the_newest_resume(settings, profile):
    tex = render(profile, resume_from_profile(profile), Layout())
    edited = tex.replace(r"\begin{document}", r"\begin{document}" + "\n% edited by hand", 1)
    store = EditStore(_job(), BASE)
    out = process_edit(
        settings, store, {"id": "e1", "job_id": "j1", "base_tailoring_id": "t0", "tex": edited}, find_engine()
    )
    assert out["status"] == "done" and out["tailoring_id"] == "t-new"
    record = store.saved[0]
    assert record["pages"] == 1 and record["cover_letter"] == "Dear team"
    assert [r["name"] for r in record["rounds"]] == ["build", "edit"]
    assert [r["kept"] for r in record["rounds"]] == [False, True]
    assert record["ats_score"] is not None
    assert store.edit_updates[0] == {"status": "compiling"}
    assert store.edit_updates[-1]["status"] == "done"


@requires_tex
def test_an_edit_that_does_not_compile_reports_the_latex_error(settings):
    store = EditStore(_job(), BASE)
    broken = r"\documentclass{article}\begin{document}\textbf{unclosed\end{document}"
    out = process_edit(
        settings, store, {"id": "e2", "job_id": "j1", "base_tailoring_id": None, "tex": broken}, find_engine()
    )
    assert out["status"] == "failed" and out["error"]
    assert store.saved == [] and store.edit_updates[-1]["status"] == "failed"


@requires_tex
def test_edited_latex_cannot_run_shell_commands(tmp_path: Path):
    marker = tmp_path / "ran"
    tex = rf"\documentclass{{article}}\begin{{document}}\immediate\write18{{touch {marker}}}x\end{{document}}"
    compile_tex(tex, find_engine())
    assert not marker.exists()


def test_an_edit_that_breaks_for_another_reason_is_marked_failed(settings):
    class Broken(EditStore):
        def get_job(self, job_id):
            raise ValueError("the job row could not be read")

    store = Broken(_job(), BASE)
    out = process_edit(settings, store, {"id": "e3", "job_id": "j1", "tex": "x"}, "pdflatex")
    assert out["status"] == "failed" and "could not be read" in out["error"]
    assert store.edit_updates[-1] == {"status": "failed", "error": out["error"]}  # not left at "compiling"
