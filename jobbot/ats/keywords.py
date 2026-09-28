"""JD keyword extraction for jobs that were not batch-scored (saved from the extension or added by hand)."""

from __future__ import annotations

from pydantic import BaseModel, Field

from jobbot.ats.score import JDKeywords
from jobbot.llm.ledger import Ledger
from jobbot.models import Job

SYSTEM = """You extract the skills an ATS would screen for from one job description.
Return short, standard skill names (e.g. "Spring Boot", "PostgreSQL", "Kubernetes", "REST APIs", "AWS"):
- required_skills: must-have technologies, tools, languages and methods, at most 15.
- preferred_skills: nice-to-have ones, at most 10.
- degree_required: true if a specific degree (e.g. B.Tech / Bachelor's in CS) is required.
Do not include soft skills, company names or job titles. Return only the JSON object."""


class ExtractedKeywords(BaseModel):
    required_skills: list[str] = Field(default_factory=list)
    preferred_skills: list[str] = Field(default_factory=list)
    degree_required: bool = False


def extract_keywords(job: Job, ledger: Ledger, models: list[str]) -> JDKeywords:
    out = ledger.call(
        purpose="keywords",
        models=models,
        system=SYSTEM,
        user=f"Job title: {job.title}\nCompany: {job.company}\n\n{job.description}",
        schema=ExtractedKeywords,
        max_output_tokens=4096,
        job_id=job.id,
    )
    return JDKeywords(
        required=out.required_skills,
        preferred=out.preferred_skills,
        degree_required=out.degree_required,
        source="extract",
    ).canonicalized()
