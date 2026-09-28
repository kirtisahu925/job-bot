"""Helpers over the master profile: experience units (roles or their sub-projects), headline choice."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Unit:
    """Something the tailor rewrites bullets for: a whole role, or one sub-project (group) of a role."""

    id: str
    entry: dict
    title: str | None
    bullets: list[str]


def experience_units(profile: dict) -> list[Unit]:
    units: list[Unit] = []
    for entry in profile.get("experience") or []:
        groups = entry.get("groups")
        if groups:
            for g in groups:
                units.append(
                    Unit(id=g["id"], entry=entry, title=g.get("title"), bullets=list(g.get("bullets") or []))
                )
        else:
            units.append(
                Unit(id=entry["id"], entry=entry, title=None, bullets=list(entry.get("bullets") or []))
            )
    return units


def experience_unit_ids(profile: dict) -> list[str]:
    return [u.id for u in experience_units(profile)]


def project_ids(profile: dict) -> list[str]:
    return [p["id"] for p in profile.get("projects") or []]


def allowed_titles(profile: dict) -> list[str]:
    titles = list(profile.get("allowed_titles") or [])
    if profile.get("headline") and profile["headline"] not in titles:
        titles.insert(0, profile["headline"])
    return titles


def choose_headline(profile: dict, proposed: str | None) -> str:
    """The model's headline if it is one of the allowed titles (case-insensitive), else the profile's."""
    wanted = (proposed or "").strip().lower()
    for title in allowed_titles(profile):
        if title.lower() == wanted:
            return title
    return profile.get("headline") or ""
