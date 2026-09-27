"""Deterministic checks for the framework's rules. Some problems are fixed in code; the rest become
precise instructions for one LLM revision call."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from jobbot.pipeline.filters import skill_vocabulary
from jobbot.tailor.schema import TailoredResume

CHARS_PER_LINE = 113
BULLET_RANGES = ((100, 113), (205, 226))
SUMMARY_RANGES = ((205, 226), (318, 339))
PASSIVE = re.compile(
    r"^(responsible for|helped( with)?|worked on|assisted|involved in|participated in|tasked with)\b", re.I
)
RULE3 = (
    r"\setlength{\spaceskip}{0.333em plus 0.2em minus 0.03em}",
    r"\hyphenpenalty=10000",
    r"\exhyphenpenalty=10000",
    r"\emergencystretch=1em",
)


@dataclass
class Issue:
    code: str  # length | passive | stub | pages | underfill | unknown_id | rule3 | markdown | emdash | pipe
    where: str  # e.g. "experience:current#2", "summary", "document"
    message: str
    llm_fixable: bool = True


@dataclass
class LintReport:
    issues: list[Issue] = field(default_factory=list)
    fixes: list[str] = field(default_factory=list)

    @property
    def llm_fixable(self) -> list[Issue]:
        return [i for i in self.issues if i.llm_fixable]


def _clean_text(text: str) -> tuple[str, list[str]]:
    notes = []
    new = text
    if "**" in new or "__" in new or "`" in new:
        new = new.replace("**", "").replace("__", "").replace("`", "")
        notes.append("removed markdown")
    if "—" in new or "---" in new:
        new = re.sub(r"\s*(—|---)\s*", ", ", new)
        notes.append("replaced em dash with comma")
    if "|" in new:
        new = re.sub(r"\s*\|\s*", ", ", new)
        notes.append("replaced pipe with comma")
    new = re.sub(r"\s+", " ", new).strip()
    return new, notes


def _in_ranges(n: int, ranges: tuple[tuple[int, int], ...]) -> bool:
    return any(lo <= n <= hi for lo, hi in ranges)


def _range_hint(n: int, ranges: tuple[tuple[int, int], ...]) -> str:
    lo, hi = min(ranges, key=lambda r: min(abs(n - r[0]), abs(n - r[1])))
    return f"is {n} characters; rewrite to {lo}-{hi}"


def sanitize(resume: TailoredResume, profile: dict) -> list[str]:
    """In-place fixes that need no LLM: markdown, em dashes, pipes, unknown ids, invented skills."""
    fixes: list[str] = []
    resume.summary, notes = _clean_text(resume.summary)
    fixes += [f"summary: {n}" for n in notes]
    for section in (resume.experience, resume.projects):
        for entry in section:
            for i, b in enumerate(entry.bullets):
                b.text, notes = _clean_text(b.text)
                fixes += [f"{entry.id}#{i + 1}: {n}" for n in notes]

    exp_ids = {e["id"] for e in profile.get("experience") or []}
    proj_ids = {p["id"] for p in profile.get("projects") or []}
    for section, valid, label in (
        (resume.experience, exp_ids, "experience"),
        (resume.projects, proj_ids, "project"),
    ):
        unknown = [e.id for e in section if e.id not in valid]
        if unknown:
            section[:] = [e for e in section if e.id in valid]
            fixes.append(f"dropped unknown {label} ids {unknown}")

    vocab = {v.lower().strip(): v for v in skill_vocabulary(profile)}
    for row in resume.skills:
        row.category, _ = _clean_text(row.category)
        kept, removed = [], []
        for item in row.items:
            clean, _ = _clean_text(item)
            (kept if clean.lower().strip() in vocab else removed).append(
                vocab.get(clean.lower().strip(), clean)
            )
        if removed:
            fixes.append(f"skills: removed items not in your profile vocabulary {removed}")
        row.items = kept
    resume.skills = [r for r in resume.skills if r.items]
    return fixes


def check_content(resume: TailoredResume) -> list[Issue]:
    issues: list[Issue] = []
    n = len(resume.summary)
    if not _in_ranges(n, SUMMARY_RANGES):
        issues.append(Issue("length", "summary", f"summary {_range_hint(n, SUMMARY_RANGES)}"))
    for kind, section in (("experience", resume.experience), ("project", resume.projects)):
        for entry in section:
            for i, b in enumerate(sorted(entry.bullets, key=lambda x: x.impact_rank)):
                where = f"{kind}:{entry.id}#{i + 1}"
                if not _in_ranges(len(b.text), BULLET_RANGES):
                    issues.append(
                        Issue(
                            "length", where, f"bullet {_range_hint(len(b.text), BULLET_RANGES)}: {b.text!r}"
                        )
                    )
                if PASSIVE.match(b.text):
                    issues.append(
                        Issue("passive", where, f"bullet starts with a passive opener: {b.text[:40]!r}")
                    )
    return issues


def check_tex(tex: str) -> list[Issue]:
    issues: list[Issue] = []
    for needle in RULE3:
        if needle not in tex:
            issues.append(Issue("rule3", "document", f"preamble is missing {needle}", llm_fixable=False))
    body = tex.split(r"\begin{document}", 1)[-1]
    if "**" in body:
        issues.append(Issue("markdown", "document", "literal ** in LaTeX body", llm_fixable=False))
    if "—" in body or "---" in body:
        issues.append(Issue("emdash", "document", "em dash in LaTeX body", llm_fixable=False))
    head = body.split(r"\ressection", 1)[0]
    if "|" in head:
        issues.append(Issue("pipe", "header", "pipe character in the contact header", llm_fixable=False))
    return issues


def bullet_locations(resume: TailoredResume, profile: dict) -> list[str]:
    """Document-order labels for every rendered bullet, matching the PDF's bullet order."""
    order = [e["id"] for e in profile.get("experience") or []]
    rewrites = {r.id: r for r in resume.experience}
    labels = []
    for eid in order:
        rw = rewrites.get(eid)
        if rw and rw.bullets:
            labels += [f"experience:{eid}#{i + 1}" for i in range(len(rw.bullets))]
    for rw in resume.projects:
        if rw.bullets:
            labels += [f"project:{rw.id}#{i + 1}" for i in range(len(rw.bullets))]
    return labels


def drop_weakest_bullet(resume: TailoredResume) -> str | None:
    """Last resort when even the tightest spacing spills onto page 2: remove the least impactful bullet
    from the entry that has the most bullets (never leaving an entry with fewer than 2)."""
    entries = [e for e in (*resume.experience, *resume.projects) if len(e.bullets) > 2]
    if not entries:
        return None
    target = max(entries, key=lambda e: len(e.bullets))
    weakest = max(target.bullets, key=lambda b: b.impact_rank)
    target.bullets.remove(weakest)
    return f"dropped weakest bullet from {target.id}: {weakest.text[:60]!r}"
