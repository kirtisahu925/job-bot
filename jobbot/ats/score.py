"""Deterministic ATS match score, modelled on keyword-matching ATS tools (Jobscan-style).

It reads the text an ATS would extract from the compiled PDF and awards points out of 100:

    required skills 45 · preferred skills 15 · job title 10 · experience years 10 · education 5
    · placement (required skills used in bullets, not only in the skills list) 5 · format 10

It also separates missing keywords into ones your profile supports (fixable by rewording) and real gaps,
and reports the best score reachable without claiming a gap ("max achievable").
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from jobbot.ats.skills import canonical, in_text, normalize_text, profile_vocabulary, skill_key

WEIGHTS = {
    "required": 45,
    "preferred": 15,
    "title": 10,
    "experience": 10,
    "education": 5,
    "placement": 5,
    "format": 10,
}

_TITLE_NOISE = {
    "senior",
    "sr",
    "junior",
    "jr",
    "lead",
    "staff",
    "principal",
    "i",
    "ii",
    "iii",
    "iv",
    "1",
    "2",
    "3",
    "4",
    "level",
    "l1",
    "l2",
    "l3",
    "grade",
    "associate",
    "the",
    "and",
    "of",
    "for",
    "with",
    "in",
    "a",
    "an",
}
_TITLE_ALIASES = {"developer": "engineer", "programmer": "engineer", "dev": "engineer", "back": "backend"}
_DEGREE = re.compile(
    r"\b(bachelor|b\.?\s?tech|b\.?\s?e\b|b\.?\s?sc|master|m\.?\s?tech|computer science|mca|bca)", re.I
)


class JDKeywords(BaseModel):
    required: list[str] = Field(default_factory=list)
    preferred: list[str] = Field(default_factory=list)
    degree_required: bool = False
    source: str = "score"

    def canonicalized(self) -> JDKeywords:
        req = _dedupe([canonical(s) for s in self.required])
        pref = [s for s in _dedupe([canonical(s) for s in self.preferred]) if s not in req]
        return JDKeywords(
            required=req, preferred=pref, degree_required=self.degree_required, source=self.source
        )


class AtsResult(BaseModel):
    score: int
    max_achievable: int
    target: int = 90
    breakdown: dict[str, dict] = Field(default_factory=dict)  # part -> {points, max, note}
    matched_required: list[str] = Field(default_factory=list)
    matched_preferred: list[str] = Field(default_factory=list)
    missing_fixable: list[str] = Field(default_factory=list)  # your profile has it; the resume doesn't say it
    missing_gaps: list[str] = Field(default_factory=list)  # not in your profile: skills to learn
    skills_only: list[str] = Field(default_factory=list)  # required, but only listed under Skills
    best_title: str | None = None


def _dedupe(items: list[str]) -> list[str]:
    seen, out = set(), []
    for item in items:
        k = skill_key(item)
        if k and k not in seen:
            seen.add(k)
            out.append(item)
    return out


def title_tokens(title: str) -> set[str]:
    base = re.split(r"\s[-–|]\s|[,(/]", title or "")[0]
    text = base.lower()
    text = re.sub(r"\bsde\b|\bsdet\b", "software development engineer", text)
    text = re.sub(r"\bswe\b", "software engineer", text)
    words = re.findall(r"[a-z0-9+#.]+", text)
    return {_TITLE_ALIASES.get(w, w) for w in words if w not in _TITLE_NOISE}


def title_overlap(job_title: str, candidate: str) -> float:
    want = title_tokens(job_title)
    if not want:
        return 1.0
    return len(want & title_tokens(candidate)) / len(want)


def profile_supports(profile: dict, known: list[str] | None = None) -> set[str]:
    """Canonical skills the profile can honestly claim (vocabulary, plus anything its bullets mention)."""
    return {canonical(t) for t in profile_vocabulary(profile, known)}


def _profile_text(profile: dict) -> str:
    parts = [profile.get("summary") or ""]
    for entry in profile.get("experience") or []:
        for group in entry.get("groups") or [entry]:
            parts += group.get("bullets") or []
    for p in profile.get("projects") or []:
        parts += p.get("bullets") or []
    return normalize_text("\n".join(parts))


def compute(
    *,
    resume_text: str,
    body_text: str,
    headline: str,
    jd: JDKeywords,
    job_title: str,
    jd_min_years: int | None,
    profile: dict,
    known_skills: list[str] | None = None,
    format_checks: dict[str, bool] | None = None,
    target: int = 90,
) -> AtsResult:
    """resume_text: everything an ATS extracts (use the PDF text). body_text: summary + bullets only."""
    jd = jd.canonicalized()
    full = normalize_text(resume_text)
    body = normalize_text(body_text)
    vocab = profile_supports(profile, known_skills)
    ptext = _profile_text(profile)

    def supported(skill: str) -> bool:
        return canonical(skill) in vocab or in_text(skill, ptext)

    matched_req = [s for s in jd.required if in_text(s, full)]
    matched_pref = [s for s in jd.preferred if in_text(s, full)]
    missing = [s for s in jd.required + jd.preferred if s not in matched_req and s not in matched_pref]
    fixable = [s for s in missing if supported(s)]
    gaps = [s for s in missing if not supported(s)]
    skills_only = [s for s in matched_req if not in_text(s, body)]

    def part(name: str, ratio: float, note: str) -> dict:
        return {
            "points": round(WEIGHTS[name] * max(0.0, min(1.0, ratio)), 1),
            "max": WEIGHTS[name],
            "note": note,
        }

    req_ratio = len(matched_req) / len(jd.required) if jd.required else 1.0
    pref_ratio = len(matched_pref) / len(jd.preferred) if jd.preferred else 1.0
    t_ratio = max(title_overlap(job_title, headline), title_overlap(job_title, body_text[:200]))
    years = float(profile.get("years_experience") or 0)
    exp_ratio = 1.0 if not jd_min_years else min(1.0, years / jd_min_years)
    edu_ok = (not jd.degree_required) or bool(_DEGREE.search(resume_text))
    place_ratio = (len(matched_req) - len(skills_only)) / len(matched_req) if matched_req else 1.0
    checks = format_checks or {}
    fmt_ratio = sum(1 for ok in checks.values() if ok) / len(checks) if checks else 1.0

    breakdown = {
        "required": part("required", req_ratio, f"{len(matched_req)} of {len(jd.required)} required skills"),
        "preferred": part(
            "preferred", pref_ratio, f"{len(matched_pref)} of {len(jd.preferred)} preferred skills"
        ),
        "title": part("title", t_ratio, f"headline vs '{job_title}'"),
        "experience": part(
            "experience",
            exp_ratio,
            f"{years:g} yrs vs {jd_min_years}+ asked" if jd_min_years else "no minimum stated",
        ),
        "education": part(
            "education", 1.0 if edu_ok else 0.0, "degree required" if jd.degree_required else "not required"
        ),
        "placement": part(
            "placement", place_ratio, f"{len(skills_only)} required skills only in the skills list"
        ),
        "format": part(
            "format", fmt_ratio, ", ".join(k for k, ok in checks.items() if not ok) or "all checks pass"
        ),
    }
    score = round(sum(p["points"] for p in breakdown.values()))

    # best honest score: every supported keyword used in a bullet, the best allowed headline
    best_title = max(profile.get("allowed_titles") or [headline], key=lambda t: title_overlap(job_title, t))
    reach_req = [s for s in jd.required if s in matched_req or supported(s)]
    reach_pref = [s for s in jd.preferred if s in matched_pref or supported(s)]
    ideal = dict(breakdown)
    ideal["required"] = part("required", len(reach_req) / len(jd.required) if jd.required else 1.0, "")
    ideal["preferred"] = part("preferred", len(reach_pref) / len(jd.preferred) if jd.preferred else 1.0, "")
    ideal["title"] = part("title", max(t_ratio, title_overlap(job_title, best_title)), "")
    ideal["placement"] = part("placement", 1.0, "")
    ideal["format"] = part("format", 1.0, "")
    max_achievable = max(score, round(sum(p["points"] for p in ideal.values())))

    return AtsResult(
        score=score,
        max_achievable=max_achievable,
        target=target,
        breakdown=breakdown,
        matched_required=matched_req,
        matched_preferred=matched_pref,
        missing_fixable=fixable,
        missing_gaps=gaps,
        skills_only=skills_only,
        best_title=best_title,
    )


def improvement_requests(result: AtsResult, job_title: str, headline: str) -> list[str]:
    """Concrete instructions for a revision round, or [] when nothing honest is left to improve."""
    asks: list[str] = []
    if result.missing_fixable:
        asks.append(
            "ATS: the job asks for these and the profile supports them, but the resume never says them. Use each "
            f"with this exact spelling where it is true (a bullet or the summary): {', '.join(result.missing_fixable)}"
        )
    if result.skills_only:
        asks.append(
            "ATS: these required skills appear only in the skills list. Mention each in a relevant bullet or the "
            f"summary where it is true: {', '.join(result.skills_only)}"
        )
    if result.best_title and title_overlap(job_title, result.best_title) > title_overlap(job_title, headline):
        asks.append(f"ATS: set headline to '{result.best_title}' (closest allowed title to '{job_title}')")
    return asks
