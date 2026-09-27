"""Markdown run summary, used for the GitHub Actions job summary and the CLI."""

from __future__ import annotations


def _money(v: float | None) -> str:
    return "-" if v is None else f"${v:,.4f}".rstrip("0").rstrip(".") if v < 1 else f"${v:,.2f}"


def _qty(v: float | None, unit: str) -> str:
    if v is None:
        return "-"
    return _money(v) if unit == "USD" else f"{int(v):,}"


def markdown(summary: dict, fx_usd_inr: float = 88.0) -> str:
    out = ["## Job bot run", ""]
    out.append(
        f"Fetched **{summary.get('fetched', 0)}** postings, **{summary.get('unique', 0)}** unique, "
        f"**{summary.get('kept', 0)}** passed filters, **{summary.get('new_jobs', 0)}** new. "
        f"Scored **{summary.get('scored', 0)}**, tailored **{summary.get('tailored', 0)}** resumes."
    )
    if summary.get("tailor_stopped"):
        out.append(f"\nTailoring stopped early: {summary['tailor_stopped']}")
    out += [
        "",
        "### Sources",
        "",
        "| Source | Status | Calls | Results | Cost | Note |",
        "|---|---|---|---|---|---|",
    ]
    for s in summary.get("sources", []):
        note = (s.get("error") or "").replace("|", "/")[:80]
        out.append(
            f"| {s['source']} | {s['status']} | {s['calls']} | {s['results']} | {_money(s['cost_usd'])} | {note} |"
        )

    llm = summary.get("llm")
    if llm:
        out += [
            "",
            "### Token consumption (this run)",
            "",
            f"{llm['requests']} requests: {llm['input_tokens']:,} input, {llm['output_tokens']:,} output and "
            f"{llm['thinking_tokens']:,} thinking tokens. Cost {_money(llm['cost_usd'])} "
            f"(would be {_money(llm['shadow_cost_usd'])} on the shadow paid model).",
        ]
    bals = summary.get("balances") or []
    if bals:
        out += [
            "",
            "### Balances",
            "",
            "| Provider | Used | Limit | Current balance | Period | Source |",
            "|---|---|---|---|---|---|",
        ]
        for b in bals:
            flag = " (low)" if b.get("low") else ""
            remaining = _qty(b.get("remaining"), b["unit"])
            if b["unit"] == "USD" and b.get("remaining") is not None:
                remaining += f" (INR {b['remaining'] * fx_usd_inr:,.0f})"
            out.append(
                f"| {b['provider']} | {_qty(b['used'], b['unit'])} | {_qty(b.get('limit'), b['unit'])} | "
                f"{remaining}{flag} | {b['period']} | {b['method']} |"
            )
    if summary.get("errors"):
        out += ["", "### Errors", ""] + [f"- {e}" for e in summary["errors"]]
    return "\n".join(out) + "\n"
