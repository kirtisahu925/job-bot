---
version: 1
slug: "dashboard-src-app-tsx"
primary_target: "dashboard/src/App.tsx"
related_targets: ["extension/popup.html","extension/options.html"]
---

# Dashboard and extension surface

Scope: the whole dashboard (Jobs, Board, Job detail with ATS panel, Skills, Add job, Consumption, Runs, Login) and the Chrome extension popup and options. Visitor mode: Operate.

Audience and task: a job-hunting software engineer, twice a day after the 10:00 and 22:00 IST scans, laptop plus phone. Triage new matches, Tailor now, read the ATS score and what holds it back, apply, track status, pick skills to learn. Constraints: every score explains itself; no fabricated numbers; 360px phone width; light and dark follow the OS; WCAG AA.

Roll: degraded (roll service unreachable from this environment, no challengers, no quality-bar boards). Ordered grounded list: 1 university marksheet / grade card; 2 GitHub pull-request review with checks; 3 competitive-programming scoreboard; 4 Indian Railways reservation chart and PNR status; 5 Zerodha Kite watchlist terminal; 6 placement-cell notice board; 7 engineering drawing sheet and lab record. Assigned: 7. Impeccable's pick (top of list, not built): the marksheet, whose risk is familiarity.

Build path: code-led (no image generation in this environment).

Name: Fairsheet. A fair sheet is the clean final drawing or the fair lab record copied from rough work: the tailored resume is a fair copy of the profile, and fair is the honesty promise.

## Direction contract

THESIS: Every job is a drawing sheet checked against its specification. The product measures fit the way a drafter dimensions a part: exact values, tolerances, hidden lines for what is absent. It refuses the category default of rounded kanban cards with a purple accent and emoji badges, and its predictable opposite, the neon hacker terminal.

OWN-WORLD: Light is a cool white drawing sheet with graphite ink and one ballpoint-blue accent for actions and selection; a thin double-rule sheet frame and a title block carry metadata. Dark is blueprint: Prussian-blue ground, white linework, a pale sodium-yellow accent. Status marks borrow checking ink: green for checked, red for correction, amber pencil for pending. Type is one engineered grotesk with tabular figures, set like drafting lettering in labels. Linework: 1px rules, square corners (2px maximum), no shadows except floating layers, no cards inside cards; tables are observation tables with ruled rows.

STORY: The engineer opens the sheet, sees what arrived since the last scan and which jobs clear tolerance, tailors the best one, reads exactly which skills held the score back, applies, and adds the recurring gaps to the learning list.

FIRST VIEWPORT: Desktop: a left rail naming the sheets (Jobs, Board, Skills, Consumption, Runs) with Add job at its foot; the main area is the Jobs observation table filling the width, with columns for match score, ATS, title and company, location, status, and the next action; filters sit in a single ruled strip above it. A title block at the top right of the sheet states the last scan, the next scan, jobs new since last visit, and quota left; it is the only framed metadata box. The primary action per row is Tailor now (or Apply once tailored), aligned to the right edge. Phone: the title block collapses to one strip under the header, rows become two-line entries with score and action on the right, and the rail becomes a bottom bar.

FORM: Engineering drawing sheet and lab record, position 7 of 7 on the ordered list, seed key ef30eca9. Signature interaction: the ATS dimension chain. On the job page the ATS breakdown is drawn as a dimension line from 0 to 100, segmented by component (required 45, preferred 15, title 10, experience 10, education 5, placement 5, format 10) with extension ticks and measured values; the best honest score is a dashed hidden line past the current score, and each gap skill is labeled as hidden. Revisions appear as a revision table (R0, R1, R2 with the score of each round). Motion grammar: 180ms ease-out state changes only; the dimension line draws its measured length once when a new score arrives; no page-load choreography.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
