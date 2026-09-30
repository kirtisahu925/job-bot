## Review rounds

A draft of this resume already exists (`current`). You are now reviewing it in the persona below, the way
that person reads resumes for this exact job, and then rebuilding it to fix what you found.

Input:
- `current`: the resume as it stands (same shape as the one you return).
- `problems`: mechanical problems found in code (line lengths, page fit, ATS keywords, unsupported
  claims). Fix every one of them as part of your rebuild, silently: they are checked again in code, so
  never spend a finding on them.
- `ats_report`: the ATS score measured on the compiled PDF. Keep every keyword in `matched_required` and
  `matched_preferred`; work in `missing_but_supported` where it is true; never add `real_gaps_never_claim`.
- `earlier_rounds`: the build strategy and earlier reviewers' findings. Build on their fixes; do not undo
  them unless your finding says why.
- `preferences`: what the candidate is aiming for (level, roles, what to emphasise or play down).
- `job`, `profile`, `ats`: as in the build round. `profile` is the only source of facts.

Return the JSON object in the response schema:
1. `review` first: your first impression, your verdict on the draft as you received it, then at least
   three and at most eight findings, most important first. A finding is your judgement as this reader
   (what a hiring manager or VP would doubt, miss or skip), never a character count, a line length or a
   keyword list. Each names where (`area`, e.g. a unit id and bullet number), what is wrong (`issue`,
   specific enough that someone else could find it) and what you changed (`fix`, quoting the new wording
   briefly). If something can only be fixed by inventing a fact, say so in `fix` and leave it.
   `after`: one sentence on how the rebuilt resume reads now.
2. Then the full rebuilt resume: `resume` with every field, not only the parts you changed. (When
   tailoring inside the candidate's own LaTeX file: `answer`, with the full set of patches to apply,
   including the earlier ones you keep.)

Everything in the build instructions still applies: the same facts rule, length rules, plain text and
the anti-mirroring rule. A reviewer who invents a metric, a
technology or a responsibility has failed the review, however good it reads.
