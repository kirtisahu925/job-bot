"""Compile LaTeX, then measure the PDF: page count, how far down the page the text reaches (Rule 2),
and whether any bullet or the summary ends in a short stub line (Rule 1)."""

from __future__ import annotations

import io
import os
import shutil
import subprocess
import tempfile
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import pdfplumber

from jobbot.tailor.latex import Layout

HEADINGS = {"Summary", "Experience", "Projects", "Technical Skills", "Education", "Certifications"}
STUB_MIN_FILL = 0.70
BULLET_MARKS = ("\u2022", "\u2013", "(cid:")  # bullet glyph, en-dash fallback label, unmapped glyph
TARGET_FILL = 0.95


class CompileError(RuntimeError):
    pass


def find_engine() -> str | None:
    preferred = os.environ.get("JOBBOT_TEX_ENGINE")
    for name in ([preferred] if preferred else []) + ["tectonic", "pdflatex"]:
        if name and shutil.which(name):
            return name
    return None


def compile_tex(tex: str, engine: str) -> bytes:
    with tempfile.TemporaryDirectory(prefix="jobbot-tex-") as tmp:
        src = Path(tmp) / "resume.tex"
        src.write_text(tex, encoding="utf-8")
        if engine == "tectonic":
            cmd = ["tectonic", "--chatter", "minimal", "--outdir", tmp, str(src)]
        else:
            cmd = [engine, "-interaction=nonstopmode", "-halt-on-error", f"-output-directory={tmp}", str(src)]
        proc = subprocess.run(cmd, cwd=tmp, capture_output=True, text=True, timeout=180)
        pdf = Path(tmp) / "resume.pdf"
        if proc.returncode != 0 or not pdf.exists():
            tail = (proc.stdout + proc.stderr)[-1500:]
            raise CompileError(f"{engine} failed (exit {proc.returncode}): {tail}")
        return pdf.read_bytes()


@dataclass
class Line:
    text: str
    x0: float
    x1: float
    top: float
    bottom: float
    text_x0: float  # where the text starts, after a leading bullet glyph if there is one


@dataclass
class PdfReport:
    pages: int
    fill_ratio: float
    bullet_fills: list[float] = field(default_factory=list)  # last-line fill of each bullet, document order
    summary_fill: float | None = None

    def stubs(self, labels: list[str]) -> list[tuple[str, float]]:
        out = [
            (labels[i] if i < len(labels) else f"bullet#{i + 1}", f) for i, f in enumerate(self.bullet_fills)
        ]
        return [(label, f) for label, f in out if f < STUB_MIN_FILL]


def _is_mark(token: str) -> bool:
    return token.startswith(BULLET_MARKS) and (len(token) == 1 or token.startswith("(cid:"))


def _lines(page) -> list[Line]:
    words = page.extract_words(use_text_flow=True, keep_blank_chars=False)
    words.sort(key=lambda w: (round(w["top"]), w["x0"]))
    lines: list[list[dict]] = []
    for w in words:
        if lines and abs(lines[-1][0]["top"] - w["top"]) < 2.5:
            lines[-1].append(w)
        else:
            lines.append([w])
    out = []
    for ws in lines:
        ws.sort(key=lambda w: w["x0"])
        text_x0 = ws[1]["x0"] if _is_mark(ws[0]["text"]) and len(ws) > 1 else ws[0]["x0"]
        out.append(
            Line(
                text=" ".join(w["text"] for w in ws),
                x0=ws[0]["x0"],
                x1=max(w["x1"] for w in ws),
                top=min(w["top"] for w in ws),
                bottom=max(w["bottom"] for w in ws),
                text_x0=text_x0,
            )
        )
    return out


def analyze_pdf(pdf_bytes: bytes, layout: Layout) -> PdfReport:
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        pages = len(pdf.pages)
        page = pdf.pages[0]
        width, height = float(page.width), float(page.height)
        lines = _lines(page)
    side, tb = layout.side_in * 72, layout.tb_in * 72
    right = width - side
    usable = height - 2 * tb
    fill = (max(line.bottom for line in lines) - tb) / usable if lines else 0.0

    bullet_fills: list[float] = []
    summary_fill: float | None = None
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.text.strip() in HEADINGS:
            i += 1
            if line.text.strip() == "Summary":
                start = i
                while i < len(lines) and lines[i].text.strip() not in HEADINGS:
                    i += 1
                if i > start:
                    last = lines[i - 1]
                    summary_fill = (last.x1 - side) / (right - side)
            continue
        if _is_mark(line.text.split(" ", 1)[0]):
            # continuation lines of the same bullet are indented to where its text starts
            text_left = line.text_x0
            j, last = i + 1, line
            while j < len(lines):
                nxt = lines[j]
                if (
                    _is_mark(nxt.text.split(" ", 1)[0])
                    or nxt.text.strip() in HEADINGS
                    or abs(nxt.x0 - text_left) > 3
                ):
                    break
                last, j = nxt, j + 1
            bullet_fills.append(round((last.x1 - text_left) / (right - text_left), 3))
            i = j
            continue
        i += 1
    return PdfReport(
        pages=pages, fill_ratio=round(fill, 3), bullet_fills=bullet_fills, summary_fill=summary_fill
    )


@dataclass
class FitResult:
    tex: str
    pdf: bytes
    report: PdfReport
    layout: Layout
    level: int
    compiles: int


def fit_one_page(render: Callable[[Layout], str], layouts: list[Layout], engine: str) -> FitResult:
    """Binary-search the loosest spacing that still fits on one page (fills the page the most).
    If even the tightest layout overflows, returns that layout's result with pages > 1."""
    cache: dict[int, tuple[str, bytes, PdfReport]] = {}

    def attempt(level: int) -> tuple[str, bytes, PdfReport]:
        if level not in cache:
            tex = render(layouts[level])
            pdf = compile_tex(tex, engine)
            cache[level] = (tex, pdf, analyze_pdf(pdf, layouts[level]))
        return cache[level]

    lo, hi, best = 0, len(layouts) - 1, None
    if attempt(lo)[2].pages > 1:
        tex, pdf, rep = attempt(lo)
        return FitResult(tex, pdf, rep, layouts[lo], lo, len(cache))
    while lo <= hi:
        mid = (lo + hi) // 2
        if attempt(mid)[2].pages == 1:
            best, lo = mid, mid + 1
        else:
            hi = mid - 1
    tex, pdf, rep = attempt(best)
    return FitResult(tex, pdf, rep, layouts[best], best, len(cache))
