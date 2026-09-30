from jobbot.config import load_settings
from jobbot.llm.fake import FakeProvider, resume_from_profile
from jobbot.llm.ledger import Ledger
from jobbot.models import Job
from jobbot.store.local_store import LocalStore
from jobbot.tailor import lint
from jobbot.tailor.compile import analyze_pdf, compile_tex, find_engine, fit_one_page
from jobbot.tailor.generate import first_prompt, profile_for_llm, tailor_job
from jobbot.tailor.latex import Layout, escape, ladder, render
from jobbot.tailor.schema import Bullet, EntryRewrite, SkillRow
from tests.conftest import requires_tex


def test_escape_handles_latex_specials_and_unicode():
    assert escape("R&D 50% of C# $5_x ₹10 | a—b") == r"R\&D 50\% of C\# \$5\_x INR 10 , a, b"


def test_sanitize_fixes_markdown_dashes_pipes_ids_and_invented_skills(profile):
    r = resume_from_profile(profile)
    r.summary = "**Backend** developer — Python | Java"
    r.experience[0].bullets[0].text = "Built **fast** APIs --- cutting latency"
    r.experience.append(EntryRewrite(id="made-up", bullets=[Bullet(text="x", impact_rank=1)]))
    r.skills.append(SkillRow(category="Extra", items=["Kubernetes", "docker"]))
    fixes = lint.sanitize(r, profile)
    assert r.summary == "Backend developer, Python, Java"
    assert r.experience[0].bullets[0].text == "Built fast APIs, cutting latency"
    assert all(e.id != "made-up" for e in r.experience)
    assert r.skills[-1].items == ["Docker"]  # Kubernetes is not in the profile, Docker is (canonical casing)
    assert any("Kubernetes" in f for f in fixes)


def test_check_content_flags_length_and_passive(profile):
    r = resume_from_profile(profile)
    r.experience[0].bullets[0].text = "Responsible for building APIs"
    codes = {(i.code, i.where) for i in lint.check_content(r)}
    assert ("length", "experience:current#1") in codes
    assert ("passive", "experience:current#1") in codes
    assert all(
        i.code != "length" or i.where != "summary" for i in lint.check_content(resume_from_profile(profile))
    )


def test_rendered_tex_has_rule3_and_clean_header(profile):
    tex = render(profile, resume_from_profile(profile), Layout())
    assert lint.check_tex(tex) == []
    assert r"\setlength{\spaceskip}{0.333em plus 0.2em minus 0.03em}" in tex
    header = tex.split(r"\begin{document}")[1].split(r"\ressection")[0]
    assert "|" not in header and "you@example.com" in header


def test_check_tex_catches_violations():
    bad = r"\documentclass{article}\begin{document}Name | phone **bold** a---b \ressection{X}\end{document}"
    codes = {i.code for i in lint.check_tex(bad)}
    assert {"rule3", "markdown", "emdash", "pipe"} <= codes


def test_contact_details_never_reach_the_llm(profile):
    job = Job(fingerprint="f", title="Dev", company="C", apply_url="u", description="jd")
    prompt = first_prompt(job, profile)
    assert "you@example.com" not in prompt and "90000" not in prompt
    assert "contact" not in profile_for_llm(profile)


def test_drop_weakest_bullet(profile):
    r = resume_from_profile(profile)
    before = len(r.experience[0].bullets)
    note = lint.drop_weakest_bullet(r)
    assert len(r.experience[0].bullets) == before - 1 and "current" in note


@requires_tex
def test_compiles_to_one_page_with_extractable_text(profile):
    engine = find_engine()
    r = resume_from_profile(profile)
    fit = fit_one_page(lambda layout: render(profile, r, layout), ladder(), engine)
    assert fit.report.pages == 1
    assert len(fit.report.bullet_fills) == 11  # every bullet detected in the PDF
    assert fit.report.stubs(lint.bullet_locations(r, profile)) == []
    import io

    import pdfplumber

    with pdfplumber.open(io.BytesIO(fit.pdf)) as pdf:
        text = pdf.pages[0].extract_text()
    assert "(cid:" not in text and "•" in text
    assert "Spring Boot" in text


@requires_tex
def test_stub_bullet_is_detected(profile):
    r = resume_from_profile(profile)
    # ~125 characters: wraps onto a second line holding only a couple of words
    r.experience[0].bullets[
        0
    ].text = "Built Python Azure Functions syncing orders from 3 delivery platforms into one dashboard, ending manual entry for stores"
    pdf = compile_tex(render(profile, r, Layout()), find_engine())
    rep = analyze_pdf(pdf, Layout())
    stubs = rep.stubs(lint.bullet_locations(r, profile))
    assert [label for label, _ in stubs] == ["experience:current#1"]


@requires_tex
def test_tailor_job_with_fake_llm(profile):
    ledger = Ledger(FakeProvider(), load_settings().pricing, LocalStore())
    job = Job(
        id="j1", fingerprint="f", title="Backend Engineer", company="Acme", apply_url="u", description="Java"
    )
    outcome = tailor_job(job, profile, ledger, ["gemini-flash-latest"], find_engine())
    assert outcome.pdf and outcome.pages == 1
    # the example profile is short, so the page is under-filled and flagged for review rather than padded
    assert outcome.status == "needs_review" and any(i.code == "underfill" for i in outcome.issues)
    # build, then the hiring manager and the VP of hiring; no fix-up, since nothing broke a hard rule
    assert outcome.revisions == 2
    assert [r.purpose for r in ledger.rows] == ["tailor", "review", "review"]
    assert [r["title"] for r in outcome.rounds] == ["Build", "Hiring manager review", "VP of hiring review"]


def test_header_links_show_their_names_and_keep_the_address_behind_them():
    from jobbot.tailor.latex import header

    h = header(
        {
            "contact": {
                "name": "A B",
                "location": "Gurgaon, India",
                "email": "a_b@example.com",
                "phone": "+91 90000 00000",
                "links": {"linkedin": "linkedin.com/in/someone", "github": "https://github.com/someone"},
            }
        }
    )
    assert (
        h["line2"]
        == r"\href{https://linkedin.com/in/someone}{LinkedIn}, \href{https://github.com/someone}{GitHub}"
    )
    # the e-mail stays readable text for ATS parsers, and is also a mailto link
    assert r"\href{mailto:a_b@example.com}{a\_b@example.com}" in h["line1"]
