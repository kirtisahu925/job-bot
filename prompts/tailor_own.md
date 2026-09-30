## How this pipeline uses the framework (your own LaTeX resume)

The candidate's own LaTeX resume is the template. Its layout, sections, roles, dates, links and order
are fixed. You rewrite only the text inside its editable slots, listed in `slots`:

- `bullet-N`: one bullet under the role or project named in `entry` (and `parent`, the company, when the
  bullet sits under a sub-project).
- `skill-N`: the items of one skills line (the category name is fixed).
- `summary-0`: the summary paragraph, when the resume has one.

Return ONLY the JSON object described by the response schema. `patches` lists the slots you change, each
with the slot's full new text. Leave a slot out to keep it as it is.

## Writing each slot
- Plain text. Mark emphasis the way the original does: `**bold**` (and `*italic*`) around the same kind of
  words it bolds (metrics, technologies). No LaTeX, no backslashes, no em dashes, no pipes.
- Rewrite bullets for this job: lead with the part of the work this job cares about, use the job's exact
  spelling of a skill the entry really involved, keep the XYZ shape (what you did, how, the result).
- Keep each bullet within about 10% of its original length, so the page still fits on one page and the
  line fill stays the same. Never merge, split or drop bullets. (The framework's character targets and
  spacing rules belong to the built-in template; here the original's lengths are the target.)
- Facts are fixed. Every number, tool, product and outcome in a bullet must already be in that bullet, in
  the same entry of the resume, or in the matching entry of `profile`. A metric the entry never states
  must not appear. Tools used in one role must not move to another.
- No vague intensifiers ("significantly", "cutting-edge", "seamlessly", "various"): use the fact instead.
- Skills lines: keep every item. Put the job's keywords first, use the job's spelling, and you may add
  items from `ats.supported_by_profile` or `ats.known_skills_without_project_evidence` to the fitting line.
  Never add an item from `ats.not_in_profile`.
- Summary: two or three plain sentences for this job, same length as the original, facts from the resume
  or profile only.

Rewrites are checked in code. Any slot that breaks these rules is dropped and the original text kept,
so a rewrite that invents is simply wasted.

## ATS keywords
`ats.supported_by_profile` are the job's keywords the candidate can honestly claim: use each at least once
where it is true, required ones in a bullet or the summary, not only in a skills line.
`ats.not_in_profile` are real gaps: never claim them.

## Phase 1 and Phase 3 fields
- `diagnostics`: as in the framework. `strong_sections` / `weak_sections` name slot ids or entries.
- `verification.ats_parser` and `verification.hiring_manager`: one or two sentences each.
