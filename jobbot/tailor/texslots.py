"""Editable text slots in your own LaTeX resume, and patching them back.

The slot finder is a Python port of career-ops' lib/latex-content.mjs (github.com/career-ops-hq/career-ops,
MIT licence). Only bullet text, the values of skills lines and a plain summary paragraph are editable;
sections, roles, dates, links and layout stay exactly as you wrote them. Two layouts are understood:
Jake's-resume style macros (\\resumeSubheading + \\resumeItem) and plain tabularx + itemize.

The model sees each slot as plain text with **bold** and *italic* markers, so emphasis survives a
rewrite; `to_latex` escapes everything else, so a rewrite can never inject LaTeX.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

SUPPORTED_FAMILIES = ("resumeSubheading", "tabularx-itemize")
UNSUPPORTED_HINT = (
    "Unsupported LaTeX resume layout. Supported: \\resumeSubheading + \\resumeItem macros (Jake's resume and "
    "its variants), or tabularx + itemize without resume macros."
)
SUMMARY_TITLES = re.compile(r"^\s*(professional\s+)?(summary|profile|about(\s+me)?|objective)\s*$", re.I)
SKILL_TITLES = re.compile(r"skill", re.I)
HEADING_MACROS = re.compile(r"\\(resume(?:Sub|SubSub|Project|Quad|Title)?[Hh]eading|resumeSubheading)\s*\{")


@dataclass(frozen=True)
class Slot:
    id: str
    kind: str  # bullet | skill | summary
    latex: str  # the text exactly as written in the file
    start: int
    end: int
    section: str = ""  # "Experience", "Projects", ...
    entry: str = ""  # heading of the role or project the slot sits under
    parent: str = ""  # the company-level heading above a sub-project heading, if any
    block: tuple[int, int] = (0, 0)  # span of that entry, for the fact gate

    @property
    def plain(self) -> str | None:
        return to_plain(self.latex)


class UnsupportedLayout(ValueError):
    pass


# ---- scanning helpers (ported) -------------------------------------------------------------------------------
def find_matching_brace(tex: str, open_idx: int) -> int:
    if open_idx >= len(tex) or tex[open_idx] != "{":
        return -1
    depth = 0
    escaped = False
    for i in range(open_idx, len(tex)):
        ch = tex[i]
        if escaped:
            escaped = False
            continue
        if ch == "\\":
            escaped = True
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i
    return -1


def body_start(tex: str) -> int:
    """Where the document body starts, so macro definitions in the preamble never become slots."""
    idx = tex.find("\\begin{document}")
    return 0 if idx == -1 else idx


def is_commented_at(tex: str, idx: int) -> bool:
    """True when an unescaped % comes earlier on the same line: commented-out bullets are not slots."""
    i = tex.rfind("\n", 0, idx) + 1
    while i < idx:
        if tex[i] == "\\":
            i += 2
            continue
        if tex[i] == "%":
            return True
        i += 1
    return False


def detect_family(tex: str) -> str | None:
    if not isinstance(tex, str) or not tex.strip():
        return None
    if re.search(r"\\resumeSubheading\b", tex) and re.search(
        r"\\(resumeItem|resumeItemWithoutTitle|resumeSubItem)\b", tex
    ):
        return "resumeSubheading"
    has_tabularx = (
        re.search(r"\\usepackage(\[[^\]]*\])?\{[^}]*tabularx[^}]*\}", tex) or "\\begin{tabularx}" in tex
    )
    if has_tabularx and "\\begin{itemize}" in tex and not re.search(r"\\resumeSubheading\b", tex):
        return "tabularx-itemize"
    return None


def macro_arity(tex: str, name: str) -> int:
    """Arguments a \\newcommand takes: old templates define \\resumeItem{title}{text}, newer ones \\resumeItem{text}."""
    m = re.search(rf"\\(?:re)?newcommand\*?\s*\{{?\\{name}\}}?\s*\[(\d)\]", tex)
    return int(m.group(1)) if m else 1


def _next_group(tex: str, i: int) -> tuple[int, int] | None:
    while i < len(tex) and tex[i].isspace():
        i += 1
    if i >= len(tex) or tex[i] != "{":
        return None
    close = find_matching_brace(tex, i)
    return (i, close) if close != -1 else None


def _raw(kind: str, start: int, end: int) -> tuple[str, int, int]:
    return (kind, start, end)


def _macro_bodies(tex: str, name: str, *, next_if_empty: bool = False) -> list[tuple[str, int, int]]:
    needle = f"\\{name}{{"
    arity = macro_arity(tex, name)
    out: list[tuple[str, int, int]] = []
    pos = body_start(tex)
    while True:
        idx = tex.find(needle, pos)
        if idx == -1:
            break
        pos = idx + len(needle)
        if is_commented_at(tex, idx):
            continue
        open_ = idx + len(needle) - 1
        close = find_matching_brace(tex, open_)
        if close == -1:
            break
        start, end = open_ + 1, close
        pos = close + 1
        if arity >= 2 or (next_if_empty and not tex[start:end].strip()):
            nxt = _next_group(tex, close + 1)
            if nxt:
                start, end = nxt[0] + 1, nxt[1]
                pos = nxt[1] + 1
            elif not tex[start:end].strip():
                continue
        out.append(_raw("bullet", start, end))
    return out


def _sub_item_values(tex: str) -> list[tuple[str, int, int]]:
    r"""\resumeSubItem{Category}{Items}: only the items are editable."""
    out = []
    needle = "\\resumeSubItem{"
    pos = body_start(tex)
    while True:
        idx = tex.find(needle, pos)
        if idx == -1:
            break
        pos = idx + len(needle)
        if is_commented_at(tex, idx):
            continue
        close_cat = find_matching_brace(tex, idx + len(needle) - 1)
        if close_cat == -1:
            break
        pos = close_cat + 1
        nxt = _next_group(tex, close_cat + 1)
        if not nxt:
            continue
        out.append(_raw("skill", nxt[0] + 1, nxt[1]))
        pos = nxt[1] + 1
    return out


def _skill_values(tex: str, sections: list[tuple[int, str]]) -> list[tuple[str, int, int]]:
    r"""\textbf{Category}{: items} anywhere, and \textbf{Category}: items \\ inside a Skills section."""
    out = []
    pos = body_start(tex)
    while True:
        idx = tex.find("\\textbf{", pos)
        if idx == -1:
            break
        pos = idx + 8
        if is_commented_at(tex, idx):
            continue
        close_cat = find_matching_brace(tex, idx + 7)
        if close_cat == -1:
            break
        pos = close_cat + 1
        c = close_cat + 1
        while c < len(tex) and tex[c] in " \t":
            c += 1
        if c < len(tex) and tex[c] == "{":
            close_val = find_matching_brace(tex, c)
            if close_val == -1:
                break
            m = re.match(r":\s*", tex[c + 1 : close_val])
            if m:
                out.append(_raw("skill", c + 1 + m.end(), close_val))
                pos = close_val + 1
        elif c < len(tex) and tex[c] == ":" and SKILL_TITLES.search(_section_at(sections, idx)):
            start = c + 1
            while start < len(tex) and tex[start] in " \t":
                start += 1
            end, depth = start, 0
            while end < len(tex) and tex[end] != "\n":
                if tex.startswith("\\\\", end) and depth == 0:
                    break
                if tex[end] == "\\":
                    end += 2
                    continue
                if tex[end] == "{":
                    depth += 1
                elif tex[end] == "}":
                    if depth == 0:
                        break
                    depth -= 1
                end += 1
            while end > start and tex[end - 1].isspace():
                end -= 1
            if end > start:
                out.append(_raw("skill", start, end))
                pos = end
    return out


def _itemize_items(tex: str) -> list[tuple[str, int, int]]:
    out = []
    base = body_start(tex)
    for m in re.finditer(r"\\item\b", tex[base:]):
        idx = base + m.start()
        if is_commented_at(tex, idx):
            continue
        i = base + m.end()
        while i < len(tex) and tex[i].isspace():
            i += 1
        if i < len(tex) and tex[i] == "{":
            close = find_matching_brace(tex, i)
            if close != -1:
                out.append(_raw("bullet", i + 1, close))
            continue
        end = tex.find("\n", i)
        end = len(tex) if end == -1 else end
        if tex[i:end].strip():
            out.append(_raw("bullet", i, end - (len(tex[i:end]) - len(tex[i:end].rstrip()))))
    return out


# ---- structure: sections and entry headings -----------------------------------------------------------------
def _sections(tex: str) -> list[tuple[int, str]]:
    out = []
    for m in re.finditer(r"\\section\*?\s*\{", tex):
        if m.start() < body_start(tex) or is_commented_at(tex, m.start()):
            continue
        close = find_matching_brace(tex, m.end() - 1)
        if close != -1:
            out.append((m.start(), to_plain(tex[m.end() : close]) or tex[m.end() : close]))
    return out


def _section_at(sections: list[tuple[int, str]], idx: int) -> str:
    title = ""
    for pos, name in sections:
        if pos > idx:
            break
        title = name
    return title


@dataclass(frozen=True)
class _Heading:
    start: int
    end: int  # end of its arguments
    text: str
    company_level: bool


def _headings(tex: str) -> list[_Heading]:
    out = []
    for m in HEADING_MACROS.finditer(tex):
        if m.start() < body_start(tex) or is_commented_at(tex, m.start()):
            continue
        parts, i = [], m.end() - 1
        for _ in range(4):
            grp = _next_group(tex, i)
            if not grp:
                break
            parts.append(to_plain(tex[grp[0] + 1 : grp[1]]) or "")
            i = grp[1] + 1
        text = " · ".join(p for p in parts[:2] if p)
        out.append(_Heading(m.start(), i, text, m.group(1) == "resumeSubheading"))
    return out


def _structure(tex: str, start: int, sections, headings) -> tuple[str, str, str, tuple[int, int]]:
    section = _section_at(sections, start)
    sec_start = max((p for p, _ in sections if p <= start), default=0)
    before = [h for h in headings if sec_start <= h.start < start]
    if not before:
        nxt = min([p for p, _ in sections if p > start] + [len(tex)])
        return section, "", "", (sec_start, nxt)
    head = before[-1]
    parent = next((h.text for h in reversed(before) if h.company_level and h is not head), "")
    later = [h.start for h in headings if h.start > head.start] + [p for p, _ in sections if p > head.start]
    return section, head.text, parent if not head.company_level else "", (head.start, min(later + [len(tex)]))


def _summary_slot(tex: str, sections: list[tuple[int, str]]) -> tuple[str, int, int] | None:
    for n, (pos, title) in enumerate(sections):
        if not SUMMARY_TITLES.match(title):
            continue
        open_ = tex.find("{", pos)
        close = find_matching_brace(tex, open_)
        end = sections[n + 1][0] if n + 1 < len(sections) else tex.find("\\end{document}", close)
        end = len(tex) if end == -1 else end
        region = tex[close + 1 : end]
        if "\\resumeItem" in region:
            return None  # written as bullets: those are bullet slots already
        # the text run: \item{...}, else \small{...}, else the bare paragraph
        for pattern in (r"\\item\s*\{", r"\\small\s*\{"):
            m = re.search(pattern, region)
            if m:
                g0 = close + 1 + m.end() - 1
                g1 = find_matching_brace(tex, g0)
                if g1 != -1:
                    inner = tex[g0 + 1 : g1]
                    if "\\item" in inner:  # \small{\item{...}}: go one level deeper
                        continue
                    lead = len(inner) - len(inner.lstrip())
                    trail = len(inner) - len(inner.rstrip())
                    return _raw("summary", g0 + 1 + lead, g1 - trail)
        stripped = region.strip()
        if stripped and "\\begin" not in stripped:
            start = close + 1 + region.index(stripped[0])
            return _raw("summary", start, start + len(stripped))
    return None


def extract_slots(tex: str) -> list[Slot]:
    """Every editable slot, in document order within each kind: bullet-N, skill-N, summary-0."""
    family = detect_family(tex)
    if family is None:
        raise UnsupportedLayout(UNSUPPORTED_HINT)
    sections = _sections(tex)
    headings = _headings(tex)
    raws: list[tuple[str, int, int]] = []
    if family == "resumeSubheading":
        raws += _macro_bodies(tex, "resumeItem")
        raws += _macro_bodies(tex, "resumeItemWithoutTitle", next_if_empty=True)
        raws += _skill_values(tex, sections)
        raws += _sub_item_values(tex)
    else:
        raws += [r for r in _itemize_items(tex) if not SKILL_TITLES.search(_section_at(sections, r[1]))]
        raws += _skill_values(tex, sections)
    summary = _summary_slot(tex, sections)
    if summary and not any(s <= summary[1] < e for _, s, e in raws):
        raws.append(summary)

    seen: set[tuple[int, int]] = set()
    counters: dict[str, int] = {}
    slots: list[Slot] = []
    for kind, start, end in sorted(raws, key=lambda r: r[1]):
        if (start, end) in seen or not tex[start:end].strip():
            continue
        # a skills line nested inside a bullet (\resumeItem{\textbf{Languages}{: ...}}) is a skill, not both
        if kind == "bullet" and any(k == "skill" and start <= s and e <= end for k, s, e in raws):
            continue
        seen.add((start, end))
        n = counters.get(kind, 0)
        counters[kind] = n + 1
        section, entry, parent, block = _structure(tex, start, sections, headings)
        slots.append(Slot(f"{kind}-{n}", kind, tex[start:end], start, end, section, entry, parent, block))
    return slots


# ---- plain text <-> LaTeX ---------------------------------------------------------------------------------
_SYMBOLS = [
    ("$\\sim$", "~"),
    ("\\textasciitilde{}", "~"),
    ("$>$", ">"),
    ("$<$", "<"),
    ("\\textgreater{}", ">"),
    ("\\textless{}", "<"),
    ("$|$", "|"),
    ("\\textbar{}", "|"),
    ("$\\pm$", "\u00b1"),
    ("$\\rightarrow$", "\u2192"),
    ("$\\to$", "\u2192"),
    ("\\ldots{}", "..."),
    ("\\ldots", "..."),
    ("\\,", " "),
    ("\\ ", " "),
]
_BOLD = re.compile(r"\\textbf\{([^{}]*)\}|\{\\bf(?:series)?\s+([^{}]*)\}")
_ITALIC = re.compile(r"\\(?:textit|emph)\{([^{}]*)\}|\{\\(?:it|em|itshape)\s+([^{}]*)\}")


def to_plain(latex: str) -> str | None:
    """The slot as the model sees it, or None when it holds LaTeX that cannot round-trip (links, colours...)."""
    s = latex.replace("~", " ")
    s = _ITALIC.sub(lambda m: f"*{m.group(1) or m.group(2)}*", s)
    s = _BOLD.sub(lambda m: f"**{m.group(1) or m.group(2)}**", s)
    for pat, rep in _SYMBOLS:
        s = s.replace(pat, rep)
    probe = re.sub(r"\\[%&$#_{}]", "", s)
    if re.search(r"[\\{}$]", probe):
        return None
    s = re.sub(r"\\([%&$#_{}])", r"\1", s)
    s = s.replace("``", "\u201c").replace("''", "\u201d")
    return re.sub(r"\s+", " ", s).strip()


_ESCAPES = {
    "\\": "\\textbackslash{}",
    "{": "\\{",
    "}": "\\}",
    "^": "\\textasciicircum{}",
    "~": "$\\sim$",
    "_": "\\_",
    "&": "\\&",
    "%": "\\%",
    "$": "\\$",
    "#": "\\#",
    "<": "\\textless{}",
    ">": "\\textgreater{}",
    "|": "\\textbar{}",
    "\u00b1": "$\\pm$",
    "\u2192": "$\\rightarrow$",
    "\u2013": "--",
    "\u2014": "---",
    "\u201c": "``",
    "\u201d": "''",
    "\u2018": "`",
    "\u2019": "'",
}


def escape_latex(text: str) -> str:
    return "".join(_ESCAPES.get(ch, ch) for ch in text)


def to_latex(plain: str) -> str:
    out = escape_latex(re.sub(r"\s+", " ", plain).strip())
    out = re.sub(r"\*\*(?=\S)(.+?)(?<=\S)\*\*", r"\\textbf{\1}", out)
    out = re.sub(r"(?<![\w*])\*(?=\S)([^*]+?)(?<=\S)\*(?![\w*])", r"\\textit{\1}", out)
    return out


def apply_patches(tex: str, slots: list[Slot], patches: dict[str, str]) -> str:
    """Replace each patched slot's text (plain, converted with `to_latex`), last slot first so spans stay valid."""
    by_id = {s.id: s for s in slots}
    todo = [(by_id[i], text) for i, text in patches.items() if i in by_id]
    out = tex
    for slot, text in sorted(todo, key=lambda p: p[0].start, reverse=True):
        out = out[: slot.start] + to_latex(text) + out[slot.end :]
    return out
