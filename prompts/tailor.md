## How this pipeline uses the framework

You write the CONTENT of the resume. A deterministic renderer turns your JSON into LaTeX with the
Rule 3 preamble, a single-column layout and the contact header already in place, then compiles it and
checks Rules 1 and 2. So:

- Return ONLY the JSON object described by the response schema. No LaTeX, no Markdown, no commentary.
- Plain text only inside every string: no `**`, no `__`, no backticks, no LaTeX commands, no em dashes
  (use a colon or comma), no pipe characters.
- The candidate's contact details are deliberately withheld. Never write a name, email, phone or URL.

## Phase 1 fields
- `diagnostics.match_score`: realistic 0-100.
- `diagnostics.missing_keywords`: the 5 most important JD keywords absent from the profile.
- `diagnostics.red_flags`: up to 3.
- `diagnostics.strong_sections` / `weak_sections`: profile entry ids (e.g. "current", "jobbot") with a
  few words of why, formatted "id: reason".

## Phase 2 fields
- `summary`: 2-3 sentences, a natural human introduction. Length 205-226 or 318-339 characters.
- `experience`: one item per profile experience entry you keep, using the entry's `id` exactly.
  Rewrite its bullets for this JD. Order bullets by impact (most impressive first) and set
  `impact_rank` 1 = strongest. Keep 3-5 bullets for the most recent role, 2-3 for older roles.
- `projects`: the 1-3 profile projects that best support this JD, by `id`, most relevant first,
  2-3 bullets each.
- `skills`: 3-6 rows `{category, items}`. Items must come from the profile's `skills` or
  `extra_vocabulary`. Put the JD-relevant categories first.
- Facts are fixed: never change numbers, employers, titles, dates or technologies the profile does not
  support. Rewording, merging and reordering are fine. If the profile lacks a metric, do not invent one.

## Rule 1 in characters
Every bullet must be 100-113 characters (one line) or 205-226 characters (two lines), counting spaces.
Count carefully before answering. Pad with real detail from the profile, or tighten wording.

## Phase 3 fields
- `verification.ats_parser`: one or two sentences on what an ATS will extract and any keyword gaps left.
- `verification.hiring_manager`: one or two sentences from the scroll test, including whether you
  rewrote the summary.
