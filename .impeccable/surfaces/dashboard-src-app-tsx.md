---
version: 1
slug: "dashboard-src-app-tsx"
primary_target: "dashboard/src/App.tsx"
related_targets: ["extension/popup.html","extension/options.html"]
---

# Dashboard and extension surface

Scope: the whole dashboard (Jobs, Board, Job detail with ATS panel, Skills, Add job, Consumption, Runs, Login) and the Chrome extension popup and options. Visitor mode: Operate.

Audience and task: a job-hunting software engineer, twice a day after the 10:00 and 22:00 IST scans, laptop plus phone. Triage new matches, Tailor now, read the ATS score and what holds it back, apply, track status, pick skills to learn. The owner also wants the product to read as a modern, launch-worthy product in a portfolio. Constraints: every score explains itself; no fabricated numbers; 360px phone width; WCAG AA.

Direction history: the engineering drawing sheet (seed ef30eca9) shipped first and the owner rejected it as not modern or launch-worthy. The owner then pinned the replacement: a Linear-style dark product UI, naming Linear and Raycast as the products it should sit alongside. The new roll (seed be007782) ran degraded (roll service unreachable, no challengers, no quality-bar boards); the owner's pinned direction supersedes its assignment, so this is the canon played straight at the named products' craft level.

Build path: code-led (no image generation in this environment).

Name: Fairsheet (kept).

## Direction contract

THESIS: The job hunt as an issue tracker. Every job is an issue moving through one workflow (New, Shortlisted, Resume queued, Resume ready, Applied, Interviewing, Offer), triaged at keyboard speed from a dense grouped list. It refuses the rejected drawing-sheet metaphor and the generic admin template of white cards and stat tiles.

OWN-WORLD: Near-black violet-tinted neutrals, surfaces one step lighter, 1px translucent hairlines, one violet accent for focus, selection and the primary action, with a soft violet glow on focus and a faint aurora at the top of the canvas. Status is a family of progress-circle icons (dashed ring for New through a filled check for Applied, red slash for Rejected). Pills: 22px, 6px corners; panels 10px; dialogs 12px. Inter variable, 13px dense base, tabular figures, 600 headings with tight tracking. A light theme mirrors the roles for daylight.

STORY: The engineer opens Jobs, sees what arrived since the last scan grouped by status with Resume ready first, moves with j/k, tailors with T, opens a job with Enter to read the ATS breakdown, applies, and jumps anywhere with ⌘K.

FIRST VIEWPORT: Desktop: a 240px sidebar (Fairsheet mark and scan status on top, a search button showing ⌘K, Add job, then Jobs, Board, Skills, Consumption, Runs with counts, account at the foot). Main: a 48px header with the page title, view tabs (Ready, New, All, Applied) and filter chips; below, the grouped list fills the width: status icon, match pill, title and company, location, ATS pill, sources, age, and the row action (Tailor now or Apply) revealed on hover and focus. Phone: header with ⌘K search, rows become two-line items, and a bottom tab bar.

FORM: Linear/Raycast product UI, owner-pinned canon (Linear, Raycast), seed key be007782 (degraded; superseded by the pinned direction). Signature interaction: the ⌘K command menu (jump to any job, tailor, add job, switch page, theme) plus keyboard triage (j/k, Enter, T, Esc). The ATS panel is a seven-segment score bar with the best-honest ghost segment and its parts list. Motion grammar: 120–180ms ease-out; the menu scales in from 0.98; rows highlight instantly; skeletons shimmer; nothing choreographed on page load.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
