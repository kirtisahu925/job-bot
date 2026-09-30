"""Tailoring inside your own LaTeX resume: slots, patching, the fact gate, and the pipeline end to end."""

import shutil
import subprocess
from pathlib import Path

import pytest

from jobbot.ats.score import JDKeywords
from jobbot.llm.fake import FakeProvider
from jobbot.llm.ledger import Ledger
from jobbot.models import Job
from jobbot.store.local_store import LocalStore
from jobbot.tailor.facts import FactGate
from jobbot.tailor.own_resume import OwnResume, tailor_own_resume
from jobbot.tailor.texslots import (
    UnsupportedLayout,
    apply_patches,
    detect_family,
    extract_slots,
    to_latex,
    to_plain,
)

FIXTURE = Path(__file__).parent / "fixtures" / "jake_resume.tex"
TEX = FIXTURE.read_text(encoding="utf-8")

PROFILE = {
    "contact": {"email": "jake@example.com"},
    "years_experience": 2,
    "skills": {
        "Languages": ["Java", "Python", "SQL", "JavaScript"],
        "Backend": ["Spring Boot", "FastAPI", "Flask", "REST APIs", "Kafka"],
    },
    "experience": [
        {
            "company": "Acme Corp",
            "role": "Software Engineer",
            "groups": [
                {
                    "id": "acme/payments",
                    "title": "Payments Platform",
                    "bullets": ["Reconciled payments with Kafka consumers, cutting mismatches by 30%"],
                }
            ],
        }
    ],
    "projects": [
        {"id": "gitlytics", "name": "Gitlytics", "tech": ["Python", "Flask", "React"], "bullets": []}
    ],
    "education": [{"degree": "B.S. Computer Science", "institution": "Texas A&M"}],
}


def by_id():
    return {s.id: s for s in extract_slots(TEX)}


def test_jake_style_resume_slots():
    assert detect_family(TEX) == "resumeSubheading"
    slots = by_id()
    assert [k for k in slots if k.startswith("bullet")] == [f"bullet-{i}" for i in range(6)]
    assert slots["skill-0"].plain == "Java, Python, SQL, JavaScript"
    assert slots["summary-0"].plain.startswith("Backend engineer with **2 years**")
    # the commented-out bullet is not a slot; the bullet holding a link cannot round-trip, so it is locked
    assert all("old bullet" not in s.latex for s in slots.values())
    assert slots["bullet-3"].plain is None
    # the sub-project bullet knows its project and its company
    assert slots["bullet-2"].entry.strip("*") == "Payments Platform"
    assert slots["bullet-2"].parent.startswith("Software Engineer")
    assert slots["bullet-0"].section == "Experience" and slots["bullet-4"].section == "Projects"


def test_plain_text_round_trip_keeps_emphasis_and_escapes():
    latex = r"Cut p99 by \textbf{40\%} for $\sim$50K users \& \emph{partners}"
    plain = to_plain(latex)
    assert plain == "Cut p99 by **40%** for ~50K users & *partners*"
    assert to_latex(plain) == r"Cut p99 by \textbf{40\%} for $\sim$50K users \& \textit{partners}"
    # anything the model writes is escaped: it can never inject LaTeX
    assert to_latex(r"\input{secrets} 100% {x}") == r"\textbackslash{}input\{secrets\} 100\% \{x\}"


def test_patches_touch_only_their_slots():
    slots = extract_slots(TEX)
    out = apply_patches(
        TEX, slots, {"skill-0": "SQL, Java, Python, JavaScript", "bullet-0": "Built a **REST API**"}
    )
    assert r"\textbf{Languages}{: SQL, Java, Python, JavaScript}" in out
    assert r"\resumeItem{Built a \textbf{REST API}}" in out
    # undo the two patches and the file is byte-for-byte the original: nothing else moved
    bullet = next(s for s in slots if s.id == "bullet-0")
    undone = out.replace(r"Built a \textbf{REST API}", bullet.latex).replace(
        "SQL, Java, Python, JavaScript", "Java, Python, SQL, JavaScript"
    )
    assert undone == TEX


def test_two_argument_resume_item_edits_the_description():
    tex = r"""\newcommand{\resumeItem}[2]{\item\small{\textbf{#1}{: #2}}}
\begin{document}
\section{Experience}
\resumeSubheading{Acme}{2024}{Engineer}{Remote}
\resumeItem{Payments}{Built the reconciliation job in Java}
\section{Skills}
\resumeSubItem{Languages}{Java, SQL}
\end{document}"""
    slots = {s.id: s for s in extract_slots(tex)}
    assert slots["bullet-0"].plain == "Built the reconciliation job in Java"
    assert slots["skill-0"].plain == "Java, SQL"


def test_tabularx_itemize_layout_and_unsupported_layouts():
    tex = r"""\usepackage{tabularx}
\begin{document}
\section{Experience}
\begin{itemize}
  \item Built the reconciliation job in Java
  \item{Moved the cron jobs to Azure Functions}
\end{itemize}
\end{document}"""
    assert detect_family(tex) == "tabularx-itemize"
    assert [s.plain for s in extract_slots(tex)] == [
        "Built the reconciliation job in Java",
        "Moved the cron jobs to Azure Functions",
    ]
    with pytest.raises(UnsupportedLayout):
        extract_slots(r"\begin{document}Just a letter.\end{document}")


@pytest.fixture
def gate():
    return FactGate(TEX, extract_slots(TEX), PROFILE, known_skills=["Redis"], job_terms=["Kafka", "AWS"])


def test_fact_gate_accepts_honest_rewrites(gate):
    assert (
        gate.check(
            "bullet-0", "Built a **REST API** in **FastAPI** and **PostgreSQL** for learning-system data"
        )
        == []
    )
    # Kafka and 30% come from the matching profile sub-project, so they may join this bullet
    assert (
        gate.check(
            "bullet-2", "Built **Kafka**-fed payment reconciliation in **Java**, cutting mismatches by 30%"
        )
        == []
    )
    assert gate.check("skill-1", "FastAPI, Spring Boot, Flask, React, Kafka, Redis") == []


def test_fact_gate_rejects_invention(gate):
    assert "uses numbers" in " ".join(
        gate.check("bullet-1", "Visualized classroom GitHub activity, cutting review time by 60%")
    )
    assert "names tools" in " ".join(
        gate.check("bullet-1", "Visualized classroom GitHub activity with Kafka streams")
    )
    assert "does not list: AWS" in " ".join(gate.check("skill-1", "Spring Boot, Flask, React, FastAPI, AWS"))
    assert "drops JavaScript" in " ".join(gate.check("skill-0", "Java, SQL, Python"))
    assert "vague wording" in " ".join(
        gate.check("bullet-4", "Significantly improved a full-stack app with **Flask**")
    )
    assert "keep it within" in " ".join(gate.check("bullet-5", "Implemented GitHub OAuth " * 6))
    assert "LaTeX" in " ".join(gate.check("bullet-5", r"Implemented \textbf{OAuth}"))


def _job():
    return Job(
        id="j1",
        fingerprint="f1",
        title="Backend Engineer",
        company="Payco",
        apply_url="",
        description="We need FastAPI, PostgreSQL and REST APIs. Java and Spring Boot are a plus.",
    )


def _jd():
    return JDKeywords(required=["FastAPI", "PostgreSQL", "REST APIs"], preferred=["Java", "Spring Boot"])


def test_pipeline_without_a_tex_engine_patches_and_scores():
    ledger = Ledger(FakeProvider(), __import__("jobbot.config").config.load_settings().pricing, LocalStore())
    own = OwnResume(TEX, engine=None)
    outcome = tailor_own_resume(_job(), PROFILE, own, ledger, ["gemini-flash-latest"], jd=_jd(), target=90)
    # the offline model moves the job's keywords to the front of each skills line; nothing else changes
    assert r"\textbf{Frameworks}{: Spring Boot, FastAPI, Flask, React}" in outcome.tex
    assert outcome.ats is not None and outcome.ats.score > 0
    record = outcome.record()
    assert record["content"]["patches"] and record["ats_score"] == outcome.ats.score
    # the same rounds as the built-in template: build, then both reviews, each on the patches so far
    assert [r["name"] for r in record["rounds"]][:3] == ["build", "hiring_manager", "vp_hiring"]
    analysis = record["rounds"][0]["analysis"]
    assert "FastAPI" in analysis["keywords"] and analysis["gaps"] == ["PostgreSQL"]


def _can_compile_jake() -> bool:
    return bool(shutil.which("pdflatex")) and all(
        subprocess.run(["kpsewhich", f"{p}.sty"], capture_output=True, text=True).stdout.strip()
        for p in ("titlesec", "enumitem", "fullpage")
    )


@pytest.mark.skipif(not _can_compile_jake(), reason="pdflatex with titlesec/enumitem/fullpage not installed")
def test_pipeline_compiles_your_file_and_keeps_its_page_count():
    ledger = Ledger(FakeProvider(), __import__("jobbot.config").config.load_settings().pricing, LocalStore())
    own = OwnResume(TEX, engine="pdflatex")
    assert own.pages == 1
    outcome = tailor_own_resume(_job(), PROFILE, own, ledger, ["gemini-flash-latest"], jd=_jd(), target=90)
    assert outcome.pdf and outcome.pages == 1 and outcome.status == "ok"
    assert outcome.ats.breakdown["format"]["points"] > 0
