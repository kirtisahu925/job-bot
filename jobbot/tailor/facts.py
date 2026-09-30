"""Fact gate for rewrites inside your own resume (career-ops' rule: tailoring may reword, reorder and
emphasise, never invent). Each rewritten slot is checked against what the original resume and the master
profile say about that same role or project; a rewrite that fails is dropped and the original text kept.

A rewrite fails when it:
- uses a number (a metric, a count, a duration) that the entry never states;
- names a tool or technology that entry never used (skills lines may add skills your profile lists);
- drops an item from a skills line;
- adds a vague intensifier ("significantly", "cutting-edge") the original did not have;
- grows more than about 25% longer than the original, which would push the page over;
- contains LaTeX, or is empty.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable

from jobbot.ats.skills import (
    _synonyms,
    canonical,
    in_text,
    normalize_text,
    profile_vocabulary,
    skill_key,
)
from jobbot.tailor.texslots import Slot, to_plain

INTENSIFIERS = (
    "world-class",
    "world class",
    "cutting-edge",
    "cutting edge",
    "state-of-the-art",
    "best-in-class",
    "next-generation",
    "game-changing",
    "revolutionary",
    "synergy",
    "synergies",
    "passionate",
    "rockstar",
    "ninja",
    "guru",
    "significantly",
    "dramatically",
    "drastically",
    "tremendously",
    "hugely",
    "massively",
    "seamlessly",
    "various",
    "numerous",
)
# tech names that are also everyday English: count them only when written with their own capitalisation
AMBIGUOUS = {"go", "r", "c", "rest", "react", "spring", "express", "swift", "spark", "flask", "rust", "next"}
NUMBER = re.compile(r"(?<![\w.])\d+(?:[.,]\d+)*")


def numbers(text: str) -> set[str]:
    return {n.replace(",", "") for n in NUMBER.findall(text)}


def rough_text(latex: str) -> str:
    """Readable text of any LaTeX fragment, for fact lookups (not for display)."""
    s = re.sub(r"(?<!\\)%.*", "", latex)
    s = re.sub(r"\\href\{[^{}]*\}", "", s)
    s = re.sub(r"\\[a-zA-Z@]+\*?(\[[^\]]*\])?", " ", s)
    s = re.sub(r"\\([%&$#_{}])", r"\1", s)
    return re.sub(r"[{}$]", " ", s)


def split_items(line: str) -> list[str]:
    """Comma-separated skills, keeping 'Azure (Functions, Blob Storage)' as one item."""
    items, depth, cur = [], 0, ""
    for ch in line:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if ch in ",;" and depth == 0:
            items.append(cur.strip())
            cur = ""
        else:
            cur += ch
    items.append(cur.strip())
    return [re.sub(r"\*+", "", i).strip() for i in items if i.strip()]


class FactGate:
    def __init__(
        self,
        tex: str,
        slots: list[Slot],
        profile: dict,
        known_skills: list[str] | None = None,
        job_terms: Iterable[str] = (),
    ):
        self.tex = tex
        self.slots = {s.id: s for s in slots}
        self.profile = profile
        vocab = profile_vocabulary(profile, known_skills)
        self.allowed_skills = {skill_key(canonical(t)) for t in vocab} | {skill_key(t) for t in vocab}
        terms = {*_synonyms()[1].keys(), *vocab, *job_terms}
        self.terms = sorted({t for t in terms if skill_key(t)}, key=len, reverse=True)
        self.whole = rough_text(tex[tex.find("\\begin{document}") :] if "\\begin{document}" in tex else tex)
        self.profile_text = json.dumps(
            {k: v for k, v in profile.items() if k not in ("contact", "example")}, ensure_ascii=False
        )

    # -- where facts may come from --------------------------------------------------------------------------
    def _profile_units(self, names: list[str]) -> str:
        """Profile text of the roles, sub-projects and projects whose names appear in these headings."""
        heads = " ".join(n.lower() for n in names if n)
        if not heads.strip():
            return ""
        out = []
        for entry in self.profile.get("experience") or []:
            company = str(entry.get("company", "")).lower()
            first = company.split()[0] if company.split() else ""
            entry_hit = bool(company) and (company in heads or (len(first) > 3 and first in heads))
            for g in entry.get("groups") or []:
                if entry_hit or str(g.get("title", "")).lower() in heads:
                    out.append(json.dumps(g, ensure_ascii=False))
            if entry_hit:
                out.append(json.dumps(entry.get("bullets") or [], ensure_ascii=False))
        for p in self.profile.get("projects") or []:
            name = str(p.get("name", "")).lower()
            short = re.sub(r"\s+(service|application|app|project)$", "", name)
            if name and (name in heads or short in heads):
                out.append(json.dumps(p, ensure_ascii=False))
        return "\n".join(out)

    def source(self, slot: Slot) -> str:
        if slot.kind == "summary":
            return self.whole + "\n" + self.profile_text
        if slot.kind == "skill":
            return self.whole
        start, end = slot.block
        return "\n".join(
            [
                rough_text(self.tex[start:end]),
                slot.entry,
                slot.parent,
                self._profile_units([slot.entry, slot.parent]),
            ]
        )

    # -- checks ---------------------------------------------------------------------------------------------
    def _terms_in(self, text: str) -> list[str]:
        norm = normalize_text(text)
        found: list[str] = []
        for t in self.terms:
            key = skill_key(t)
            if key in AMBIGUOUS:
                if re.search(rf"(?<![\w-]){re.escape(t)}(?![\w-])", text) and t not in found:
                    found.append(t)
            elif in_text(t, norm) and not any(in_text(t, normalize_text(f)) for f in found):
                found.append(t)
        return found

    def _has(self, term: str, text: str) -> bool:
        if skill_key(term) in AMBIGUOUS:
            return bool(re.search(rf"(?<![\w-]){re.escape(term)}(?![\w-])", text))
        return in_text(term, normalize_text(text))

    def check(self, slot_id: str, new: str) -> list[str]:
        """Reasons this rewrite is rejected; [] means it passes."""
        slot = self.slots.get(slot_id)
        if slot is None:
            return [f"{slot_id}: no such slot"]
        orig = to_plain(slot.latex) or ""
        text = (new or "").strip()
        if not text:
            return [f"{slot_id}: empty rewrite"]
        if "\\" in text:
            return [f"{slot_id}: contains LaTeX; write plain text with **bold** only"]
        reasons: list[str] = []
        limit = len(orig) + 45 if slot.kind == "skill" else round(len(orig) * 1.25) + 12
        if len(text) > limit:
            reasons.append(
                f"{slot_id}: {len(text)} characters against {len(orig)} in your resume; keep it within "
                "about a quarter longer so the page still fits"
            )
        source = self.source(slot)
        new_numbers = numbers(text) - numbers(source) - numbers(orig)
        if new_numbers:
            reasons.append(
                f"{slot_id}: uses numbers your resume never states for this: {', '.join(sorted(new_numbers))}"
            )
        added = [t for t in self._terms_in(text) if not self._has(t, orig) and not self._has(t, source)]
        if slot.kind == "skill":
            added = [
                t
                for t in added
                if skill_key(t) not in self.allowed_skills
                and skill_key(canonical(t)) not in self.allowed_skills
            ]
            if added:
                reasons.append(f"{slot_id}: adds skills your profile does not list: {', '.join(added)}")
            new_items = normalize_text(text)
            dropped = [
                i for i in split_items(orig) if not in_text(i, new_items) and skill_key(i) not in new_items
            ]
            if dropped:
                reasons.append(f"{slot_id}: drops {', '.join(dropped)}; keep every item (reordering is fine)")
        elif added:
            where = "this role or project" if slot.kind == "bullet" else "your resume"
            reasons.append(f"{slot_id}: names tools {where} never mentions: {', '.join(added)}")
        low_new, low_orig = text.lower(), orig.lower()
        vague = [w for w in INTENSIFIERS if re.search(rf"\b{re.escape(w)}\b", low_new) and w not in low_orig]
        if vague:
            reasons.append(f"{slot_id}: vague wording adds no fact: {', '.join(vague)}")
        if "\u2014" in text and "\u2014" not in orig and "---" not in slot.latex:
            reasons.append(f"{slot_id}: em dash; use a comma or colon")
        return reasons
