## How this pipeline uses the framework

You write the CONTENT of the resume. A deterministic renderer turns your JSON into LaTeX with the
Rule 3 preamble, a single-column layout and the contact header already in place, then compiles it and
checks Rules 1 and 2, and measures an ATS keyword score against the job. So:

- Return ONLY the JSON object described by the response schema. No LaTeX, no Markdown, no commentary.
- Plain text only inside every string: no `**`, no `__`, no backticks, no LaTeX commands, no em dashes
  (use a colon or comma), no pipe characters.
- The candidate's contact details are deliberately withheld. Never write a name, email, phone or URL.

## Phase 1 fields
- `diagnostics.match_score`: realistic 0-100 for the candidate's base profile against this job.
- `diagnostics.missing_keywords`: the 5 most important JD keywords absent from the profile.
- `diagnostics.red_flags`: up to 3.
- `diagnostics.strong_sections` / `weak_sections`: profile unit ids (e.g. "burger-singh/aadhaar",
  "url-shortener") with a few words of why, formatted "id: reason".

## Phase 2 fields
- `headline`: copy exactly one entry from `profile.allowed_titles`, the one closest to the job title.
- `summary`: 2-3 sentences, a natural human introduction. Length 205-226 or 318-339 characters.
- `experience`: one item per experience UNIT you keep. A unit is a role's sub-project (`groups[].id`,
  e.g. "burger-singh/franchise") or, for roles without groups, the role's own `id`. Use ids exactly.
  Keep the units most relevant to this job and drop the rest; the most recent role should keep at least
  two units. Rewrite each kept unit's bullets for this JD, order them by impact (most impressive first)
  and set `impact_rank` 1 = strongest. About 12-15 experience bullets in total fits one page.
- `projects`: the 0-2 profile projects that best support this JD, by `id`, most relevant first.
- `skills`: 4-7 rows `{category, items}`. Items must come from the profile's `skills` (you may split
  "Azure (Functions, Blob Storage, VM)" into its parts), `extra_vocabulary`, project tech, or
  `ats.known_skills_without_project_evidence`. Put the JD-relevant categories and items first.
- `achievements`: the profile's achievements reworded to 100-113 or 205-226 characters, same facts.
- Facts are fixed: never change numbers, employers, titles, dates or technologies the profile does not
  support. Rewording, merging and reordering are fine. If the profile lacks a metric, do not invent one.

## ATS keywords
The input's `ats` object lists the job's `required` and `preferred` skills, split into
`supported_by_profile` and `not_in_profile`.
- Use every `supported_by_profile` keyword at least once, with the job's exact spelling, where it is
  truthful: required ones inside summary or experience/project bullets (not only in the skills list).
- Never claim a `not_in_profile` keyword anywhere. It is a real gap; the candidate sees it separately.
- `known_skills_without_project_evidence` may go in the skills list only, never in a bullet.

## Rule 1 in characters
Every bullet and achievement must be 100-113 characters (one line) or 205-226 characters (two lines),
counting spaces. Count carefully before answering. Pad with real detail from the profile, or tighten.

## Phase 3 fields
- `verification.ats_parser`: one or two sentences on what an ATS will extract and any keyword gaps left.
- `verification.hiring_manager`: one or two sentences from the scroll test, including whether you
  rewrote the summary.
