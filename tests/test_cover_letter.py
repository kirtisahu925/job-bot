"""Cover letters: written from the tailored resume, with unsupported sentences removed before saving."""

from jobbot.config import load_settings
from jobbot.llm.fake import FakeProvider
from jobbot.llm.ledger import Ledger
from jobbot.models import Job
from jobbot.store.local_store import LocalStore
from jobbot.tailor.cover_letter import _terms, check_letter, write_cover_letter

PROFILE = {
    "contact": {"name": "Jake Ryan"},
    "skills": {"Backend": ["Java", "Spring Boot", "PostgreSQL"]},
}
RESUME = "Built payment reconciliation in Java and Spring Boot, cutting mismatches by 30% across 12 services."


def test_sentences_with_invented_facts_are_removed_and_the_layout_kept():
    letter = (
        "Dear Hiring Team,\nI am applying for the Backend Engineer role at Payco.\n\n"
        "I built payment reconciliation in Java, cutting mismatches by 30%. I also ran Kafka at 2M events a day. "
        "I am passionate about clean code.\n\n"
        "I would welcome a conversation about the role.\n\nRegards,\nJake Ryan"
    )
    text, removed = check_letter(letter, RESUME + " Payco Backend Engineer", _terms(PROFILE, []))
    assert text.startswith("Dear Hiring Team,\nI am applying")
    assert "cutting mismatches by 30%" in text
    assert "Kafka" not in text and "passionate" not in text
    assert text.endswith("Regards,\nJake Ryan")
    assert len(removed) == 2 and "Kafka" in removed[0]


def test_placeholders_are_removed():
    text, removed = check_letter("Dear [Hiring Manager],\nThanks for reading.", RESUME, _terms(PROFILE, []))
    assert text == "Thanks for reading." and removed


def test_write_cover_letter_with_the_offline_model():
    ledger = Ledger(FakeProvider(), load_settings().pricing, LocalStore())
    job = Job(
        id="j1", fingerprint="f1", title="Backend Engineer", company="Payco", apply_url="", description="Java"
    )
    text, removed = write_cover_letter(job, PROFILE, RESUME, ledger, ["gemini-flash-lite-latest"])
    assert "Backend Engineer role at Payco" in text and text.endswith("Jake Ryan") and removed == []
    assert ledger.rows[-1].purpose == "cover_letter"
