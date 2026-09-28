"""Deterministic LaTeX rendering: LLM content + profile facts -> .tex (Rule 3 preamble always present)."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass

import jinja2

from jobbot.config import TEMPLATES_DIR
from jobbot.profile import experience_units
from jobbot.tailor.schema import TailoredResume

# An entry header longer than this (role, company, location + dates) is split over two lines.
HEADER_LINE_CHARS = 92


@dataclass(frozen=True)
class Layout:
    """Only vertical spacing varies, so line wrapping (and Rule 1 line-fill) stays stable.

    10pt Latin Modern with 0.45in side margins was measured to fit 114-117 characters per bullet line,
    so the framework's 100-113 (one line) and 205-226 (two lines) targets hold.
    """

    side_in: float = 0.45
    tb_in: float = 0.5
    font_pt: float = 10.0
    baseline_pt: float = 12.0
    linespread: float = 1.0
    item_sep_pt: float = 1.0
    sec_before_pt: float = 6.0
    sec_after_pt: float = 3.0
    entry_gap_pt: float = 3.0


def ladder(steps: int = 9) -> list[Layout]:
    """Layouts from tightest to loosest vertical spacing."""
    tight = dict(
        tb_in=0.35, linespread=1.0, item_sep_pt=0.0, sec_before_pt=3.0, sec_after_pt=1.5, entry_gap_pt=1.0
    )
    loose = dict(
        tb_in=0.75, linespread=1.08, item_sep_pt=3.0, sec_before_pt=11.0, sec_after_pt=4.0, entry_gap_pt=7.0
    )
    out = []
    for i in range(steps):
        t = i / (steps - 1)
        out.append(Layout(**{k: round(tight[k] + (loose[k] - tight[k]) * t, 3) for k in tight}))
    return out


_REPLACEMENTS = {
    "’": "'",
    "‘": "`",
    "“": "``",
    "”": "''",
    "–": "--",
    "—": ", ",
    "•": "-",
    "…": "...",
    "₹": "INR ",
    " ": " ",
    "→": "to",
}
_SPECIAL = {
    "\\": r"\textbackslash{}",
    "&": r"\&",
    "%": r"\%",
    "$": r"\$",
    "#": r"\#",
    "_": r"\_",
    "{": r"\{",
    "}": r"\}",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
    "<": r"\textless{}",
    ">": r"\textgreater{}",
    "|": ",",
}


def escape(text: str | None) -> str:
    if not text:
        return ""
    out = []
    for ch in str(text):
        if ch in _SPECIAL:
            out.append(_SPECIAL[ch])
        elif ch in _REPLACEMENTS:
            out.append(_REPLACEMENTS[ch])
        else:
            out.append(ch)
    return re.sub(r"[ \t]+", " ", "".join(out)).strip()


def _dates(entry: dict) -> str:
    start, end = entry.get("start"), entry.get("end")
    if start and end:
        return f"{start} -- {end}"
    return str(start or end or "")


def header(profile: dict, headline: str = "") -> dict[str, str]:
    """Contact header from the local profile only. Commas, never pipes (Phase 3 ATS rule)."""
    c = profile.get("contact") or {}
    line1 = ", ".join(escape(x) for x in (c.get("location"), c.get("email"), c.get("phone")) if x)
    links = [escape(v) for v in (c.get("links") or {}).values() if v]
    return {
        "name": escape(c.get("name", "")),
        "headline": escape(headline or profile.get("headline") or ""),
        "line1": line1,
        "line2": ", ".join(links),
    }


def achievements_of(resume: TailoredResume, profile: dict) -> list[str]:
    """The tailored wording when the model supplied one, else the profile's own lines."""
    return [a for a in resume.achievements if a.strip()] or list(profile.get("achievements") or [])


def _ranked(bullets) -> list[str]:
    return [escape(b.text) for b in sorted(bullets, key=lambda b: b.impact_rank)]


def assemble(profile: dict, resume: TailoredResume) -> dict:
    """Merge rewritten bullets with profile facts. Roles and their sub-projects keep profile (chronological)
    order; projects keep the model's relevance order."""
    proj_by_id = {p["id"]: p for p in profile.get("projects") or []}
    rewrites = {r.id: r for r in resume.experience}

    experience = []
    for entry in profile.get("experience") or []:
        units = []
        for unit in experience_units({"experience": [entry]}):
            rw = rewrites.get(unit.id)
            if rw and rw.bullets:
                units.append(
                    {"title": escape(unit.title) if unit.title else "", "bullets": _ranked(rw.bullets)}
                )
        if not units:
            continue
        one_line = ", ".join(str(entry.get(k) or "") for k in ("role", "company", "location")) + _dates(entry)
        experience.append(
            {
                "role": escape(entry.get("role")),
                "company": escape(entry.get("company")),
                "location": escape(entry.get("location")),
                "dates": escape(_dates(entry)),
                "units": units,
                "two_line": len(one_line) > HEADER_LINE_CHARS,
            }
        )

    projects = []
    for rw in resume.projects:
        p = proj_by_id.get(rw.id)
        if p is None or not rw.bullets:
            continue
        one_line = f"{p.get('name')}: {', '.join(p.get('tech') or [])} {p.get('link') or ''}"
        projects.append(
            {
                "two_line": len(one_line) > HEADER_LINE_CHARS,
                "name": escape(p.get("name")),
                "tech": ", ".join(escape(t) for t in p.get("tech") or []),
                "link": escape(p.get("link")),
                "bullets": _ranked(rw.bullets),
            }
        )

    skills = [
        {"category": escape(row.category), "skill_list": ", ".join(escape(i) for i in row.items)}
        for row in resume.skills
        if row.items
    ]
    education = [
        {
            "institution": escape(e.get("institution")),
            "location": escape(e.get("location")),
            "dates": escape(_dates(e)),
            "degree": escape(e.get("degree")),
            "score": escape(e.get("score")),
        }
        for e in profile.get("education") or []
    ]
    return {
        "header": header(profile, resume.headline),
        "summary": escape(resume.summary),
        "experience": experience,
        "projects": projects,
        "skills": skills,
        "education": education,
        "achievements": [escape(a) for a in achievements_of(resume, profile)],
        "certifications": [escape(c) for c in profile.get("certifications") or []],
    }


def _env() -> jinja2.Environment:
    return jinja2.Environment(
        loader=jinja2.FileSystemLoader(str(TEMPLATES_DIR)),
        block_start_string="((*",
        block_end_string="*))",
        variable_start_string="(((",
        variable_end_string=")))",
        comment_start_string="((#",
        comment_end_string="#))",
        trim_blocks=True,
        lstrip_blocks=True,
        autoescape=False,
        undefined=jinja2.StrictUndefined,
    )


def render(profile: dict, resume: TailoredResume, layout: Layout) -> str:
    data = assemble(profile, resume)
    return _env().get_template("resume.tex.j2").render(L=asdict(layout), **data)
