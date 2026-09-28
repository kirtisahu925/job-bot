"""Skill names: split compound resume items, map spellings to one canonical name, find them in text."""

from __future__ import annotations

import re
from functools import lru_cache

import yaml

from jobbot.config import CONFIG_DIR

_SPACES = re.compile(r"\s+")


def skill_key(term: str) -> str:
    """Comparison key: lowercase, unify separators, keep characters that matter in tech names (+ # . /)."""
    t = term.lower().replace("_", " ").replace("–", "-")
    t = re.sub(r"[^a-z0-9+#./ -]", " ", t)
    t = re.sub(r"\s*-\s*", " ", t)
    return _SPACES.sub(" ", t).strip(" .")


@lru_cache(maxsize=1)
def _synonyms() -> tuple[dict[str, str], dict[str, list[str]]]:
    path = CONFIG_DIR / "skills_synonyms.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else {}
    alias_to_canon: dict[str, str] = {}
    canon_to_aliases: dict[str, list[str]] = {}
    for canon, aliases in (data or {}).items():
        names = [canon, *(aliases or [])]
        canon_to_aliases[canon] = names
        for name in names:
            alias_to_canon[skill_key(name)] = canon
    return alias_to_canon, canon_to_aliases


def canonical(term: str) -> str:
    """'springboot' -> 'Spring Boot', 'K8s' -> 'Kubernetes'; unknown terms keep their own spelling."""
    term = _SPACES.sub(" ", str(term)).strip()
    return _synonyms()[0].get(skill_key(term), term)


def expand_item(item: str) -> list[str]:
    """'Azure (Functions, Blob Storage, VM)' -> Azure, Azure Functions, Functions, Azure Blob Storage, ...
    'Hibernate/JPA' -> Hibernate, JPA. Used to build the vocabulary a resume may draw on."""
    item = str(item).strip()
    m = re.match(r"^(.*?)\s*\((.*)\)\s*$", item)
    terms: list[str] = []
    if m:
        parent, children = m.group(1).strip(), [c.strip() for c in m.group(2).split(",") if c.strip()]
        terms += [parent, item]
        for child in children:
            terms += [child, f"{parent} {child}"]
    elif "/" in item and not re.search(r"\bci/cd\b", item, re.I):
        terms += [item, *[p.strip() for p in item.split("/") if p.strip()]]
    else:
        terms.append(item)
    out: list[str] = []
    for t in terms:
        for form in (t, canonical(t)):
            if form and form not in out:
                out.append(form)
    return out


def profile_vocabulary(profile: dict, extra: list[str] | None = None) -> list[str]:
    """Every skill the candidate can legitimately list: skills, extra_vocabulary, project tech, and skills
    marked 'I know this' on the dashboard (passed in as `extra`)."""
    items: list[str] = []
    for values in (profile.get("skills") or {}).values():
        items += values or []
    items += profile.get("extra_vocabulary") or []
    for p in profile.get("projects") or []:
        items += p.get("tech") or []
    items += extra or []
    vocab: list[str] = []
    seen: set[str] = set()
    for item in items:
        for term in expand_item(item):
            k = skill_key(term)
            if k and k not in seen:
                seen.add(k)
                vocab.append(term)
    return vocab


def canonical_set(terms: list[str]) -> set[str]:
    return {canonical(t) for t in terms}


def aliases(canon: str) -> list[str]:
    return _synonyms()[1].get(canon, [canon])


def _pattern(term: str) -> re.Pattern[str]:
    body = r"[ -]?".join(re.escape(part) for part in skill_key(term).split(" "))
    return re.compile(rf"(?<![a-z0-9]){body}(?![a-z0-9+#])")


def normalize_text(text: str) -> str:
    return " " + skill_key(text) + " "


def in_text(skill: str, norm_text: str) -> bool:
    """Is this skill (in any known spelling) present in text already passed through normalize_text()?"""
    names = {skill, canonical(skill), *aliases(canonical(skill))}
    return any(_pattern(n).search(norm_text) for n in names if skill_key(n))
