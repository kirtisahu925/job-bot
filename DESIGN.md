---
name: Fairsheet
description: The job hunt as an issue tracker; a dark, dense, keyboard-first product UI in the Linear and Raycast tradition, where every score explains itself.
colors:
  # Dark (default world: :root, no data-theme attribute)
  canvas: "#0b0b0f"
  sidebar: "#0e0e13"
  surface-1: "#131319"
  surface-2: "#1a1a22"
  surface-3: "#22222c"
  line: "#22222b"
  line-strong: "#30303c"
  control: "#3a3a48"
  text: "#ededf2"
  text-2: "#b6b6c3"
  text-3: "#8a8a9c"
  violet: "#6d5ef0"
  violet-hover: "#7d70f5"
  violet-text: "#a59cff"
  violet-soft: "rgb(109 94 240 / 0.16)"
  on-violet: "#ffffff"
  selection: "rgb(109 94 240 / 0.38)"
  good: "#4cc38a"
  good-soft: "rgb(76 195 138 / 0.14)"
  warn: "#f0b429"
  warn-soft: "rgb(240 180 41 / 0.14)"
  bad: "#f2646d"
  bad-soft: "rgb(242 100 109 / 0.14)"
  info: "#4fb8f0"
  series-ink: "#66667a"
  overlay: "rgb(4 4 8 / 0.62)"
  # Light (data-theme="light", or data-theme="system" when the device prefers light)
  light-canvas: "#fbfbfc"
  light-sidebar: "#f4f4f7"
  light-surface-1: "#ffffff"
  light-surface-2: "#f2f2f6"
  light-surface-3: "#e8e8ef"
  light-line: "#e6e6ec"
  light-line-strong: "#d4d4de"
  light-control: "#c4c4d0"
  light-text: "#16161d"
  light-text-2: "#464655"
  light-text-3: "#676778"
  light-violet: "#5b4bdb"
  light-violet-hover: "#4d3ecd"
  light-violet-text: "#4f3fd0"
  light-violet-soft: "rgb(91 75 219 / 0.1)"
  light-selection: "rgb(91 75 219 / 0.2)"
  light-good: "#1d8150"
  light-warn: "#9a6200"
  light-bad: "#c9303a"
  light-info: "#0b76b3"
  light-series-ink: "#8a8a9c"
  light-overlay: "rgb(20 20 30 / 0.28)"
typography:
  display:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.035em"
    fontFeature: "\"cv11\", \"ss03\", \"tnum\""
  headline:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
    fontFeature: "\"cv11\", \"ss03\""
  title:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
    fontFeature: "\"cv11\", \"ss03\""
  title-sm:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.25
    fontFeature: "\"cv11\", \"ss03\""
  body:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "\"cv11\", \"ss03\""
  label:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.5
    fontFeature: "\"cv11\", \"ss03\""
  mono:
    fontFamily: "JetBrains Mono Variable, ui-monospace, monospace"
    fontSize: "0.86em"
    fontWeight: 400
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  full: "999px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  row: "12px"
  lg: "16px"
  panel-x: "18px"
  xl: "20px"
  section: "28px"
  page-x: "32px"
components:
  button:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-hover:
    backgroundColor: "{colors.surface-3}"
  button-primary:
    backgroundColor: "{colors.violet}"
    textColor: "{colors.on-violet}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.violet-hover}"
  button-act:
    backgroundColor: "{colors.violet-soft}"
    textColor: "{colors.violet-text}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-act-hover:
    backgroundColor: "{colors.violet}"
    textColor: "{colors.on-violet}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    rounded: "{rounded.md}"
  button-quiet-hover:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
  button-small:
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "28px"
  input:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "32px"
  pill:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-2}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "22px"
  pill-ats-on-target:
    backgroundColor: "{colors.good-soft}"
    textColor: "{colors.good}"
  pill-ats-below-minimum:
    backgroundColor: "{colors.bad-soft}"
    textColor: "{colors.bad}"
  tag:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.full}"
    padding: "0 9px"
    height: "24px"
  tag-fixable:
    backgroundColor: "{colors.violet-soft}"
    textColor: "{colors.violet-text}"
  tag-gap:
    backgroundColor: "transparent"
    textColor: "{colors.text-3}"
  chip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.full}"
    padding: "0 4px 0 10px"
    height: "26px"
  view-tab:
    backgroundColor: "transparent"
    textColor: "{colors.text-3}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "26px"
  view-tab-active:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text}"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "30px"
  nav-item-active:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text}"
  panel:
    backgroundColor: "{colors.surface-1}"
    rounded: "{rounded.lg}"
    padding: "16px 18px"
  job-row:
    backgroundColor: "{colors.surface-1}"
    padding: "5px 14px"
    height: "46px"
  job-row-cursor:
    backgroundColor: "{colors.surface-2}"
  group-head:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    padding: "0 14px"
    height: "36px"
  command-menu:
    backgroundColor: "{colors.surface-1}"
    rounded: "{rounded.xl}"
    width: "620px"
  command-item-active:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    height: "38px"
  kbd:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-2}"
    height: "20px"
  tooltip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
---

# Design System: Fairsheet

## Overview

**Creative North Star: "The Job Hunt as an Issue Tracker"**

Fairsheet is a dark-first product UI that sits alongside Linear and Raycast. Every job is an issue moving through one workflow (New, Shortlisted, Resume queued, Resume ready, Applied, Interviewing, Offer), triaged at keyboard speed from a dense grouped list. The canvas is near-black with a violet tint, surfaces step one tone lighter, 1px hairlines divide everything, and a single violet accent marks focus, selection, the cursor and the one action that matters next. A faint violet aurora sits at the top of the main column and the login screen; nothing else decorates.

Density is the point: a 13px base, 46px list rows, 32px controls, 22px pills. Numbers use tabular figures so columns of scores line up. Scores never stand alone: the ATS panel shows the earned parts, the reachable points and the gap on a true 0 to 100 scale. Motion is short (150ms, ease-out-expo), the command menu scales in from 0.98, rows highlight instantly, skeletons shimmer, and nothing is choreographed on page load.

Dark is the default world. A light theme mirrors every role for daylight, and a "follow device" option applies light only when the OS prefers it. The rejected drawing-sheet metaphor and the generic admin template (white cards, stat tiles) are both out.

**Key Characteristics:**
- Near-black violet-tinted neutrals with three surface steps and 1px hairlines.
- One violet accent; semantic green, amber, red and blue only where they carry meaning.
- Inter Variable at a 13px dense base, 600 headings with tight tracking, tabular figures.
- Status as a family of progress-circle icons.
- Keyboard-first: ⌘K command menu, j/k/Enter/T/A/Esc triage, `/` to search.
- Radius ladder: 6px pills and small controls, 8px buttons and inputs, 10px panels, 12px dialogs.

## Colors

A monochrome violet-grey ramp carrying one saturated violet, with four semantic hues held back for meaning.

### Primary
- **Signal Violet** (`violet`; `light-violet` in light): the primary button, the hovered chart bar, earned ATS segments, the focus outline, the input focus border, the checkbox accent and the brand mark tile. Its hover step (`violet-hover`) is lighter in dark and deeper in light.
- **Violet Ink** (`violet-text`): violet used as text or icon colour on dark surfaces (active nav icon, selected command item icon, "Tailor now" label, fixable keyword text, "best honest" figures, the Applied status circle). It is the accessible form of the accent for type (7.7:1 on surface-1 in dark, 7.1:1 on white in light).
- **Violet Wash** (`violet-soft`): the "Tailor now" act button at rest, fixable keyword tags, the kept revision pill, the avatar ground, the input focus halo, the board drop target.

### Neutral
- **Night Canvas** (`canvas`): page ground behind everything; also the knockout colour inside filled status circles.
- **Sidebar Night** (`sidebar`): the 240px sidebar, the phone header and the phone tab bar; one hair darker than surface-1 so the rail recedes.
- **Surface One / Two / Three** (`surface-1`, `surface-2`, `surface-3`): panels and lists; hovered rows, group heads, pills, tags, default buttons, tooltips; active nav item, active view tab, selected command item, empty meter and score-bar track.
- **Hairline / Strong Hairline** (`line`, `line-strong`): every divider and container edge; strong for control edges, pills, tags and dialog borders.
- **Control Edge** (`control`): the hover edge of buttons, inputs and board cards.
- **Primary / Secondary / Tertiary Text** (`text`, `text-2`, `text-3`): titles and figures; body copy and nav labels; metadata, column headers, placeholders, counts and chart ticks.

### Semantic
- **Good** (`good`, `good-soft`): ATS on target (90+), the target marker on the score bar, healthy sources, matched keywords' check, Tailored and Offer status, the live-scan pulse.
- **Warn** (`warn`, `warn-soft`): "Check posting" flag, Resume queued status, the in-progress "Tailoring" spinner, quota under 40%.
- **Bad** (`bad`, `bad-soft`): "Do not apply" flag, ATS below 80, Rejected status, errors, quota under 20%.
- **Info** (`info`): the Interviewing status circle only.

### Data
- **Series Ink** (`series-ink`; `light-series-ink` in light): the neutral ink of any single-series chart. It clears 3:1 against its panel in both themes (3.3:1 on surface-1 dark, 3.4:1 on white).

### Named Rules
**The One Violet Rule.** Violet marks focus, selection, the cursor, the next action and earned score. It never fills a panel, a heading or a decorative shape.

**The Neutral Ink Rule.** A single-series chart draws in series ink; only the hovered bar takes violet. Colour in a chart means "you are pointing here", never "this is data".

**The Meaning-Only Semantics Rule.** Green, amber, red and blue appear only when they report a state (target met, check this, stop, interviewing). A calm screen is a grey screen with one violet.

## Typography

**Display Font:** Inter Variable (self-hosted via @fontsource-variable/inter; falls back to Inter, system-ui, -apple-system, Segoe UI)
**Body Font:** Inter Variable
**Label/Mono Font:** JetBrains Mono Variable (self-hosted via @fontsource-variable/jetbrains-mono), for inline code only

**Character:** One neutral grotesque carrying everything, set small and tight with stylistic alternates `cv11` and `ss03` on globally, so weight and tone, not size, build the hierarchy. The Inter choice is owner-pinned (a sanctioned shared ignore in `.impeccable/config.json`).

### Hierarchy
- **Display** (600, 2.5rem, line-height 1, -0.035em, tabular): the ATS score figure on the job page. One per screen.
- **Headline** (600, 1.375rem, 1.25, -0.02em): page titles on detail and form pages (job title, Add a job).
- **Title** (600, 1.0625rem, 1.25, -0.01em): section headings, and the page title inside the compact list bar on Jobs.
- **Title Small** (600, 0.9375rem, 1.25): panel headings and section-head titles, empty-state headings.
- **Body** (400, 0.8125rem, 1.5): all running text, table cells, nav items, buttons. Prose is capped at 72ch; job descriptions at 72ch with 1.65 line-height.
- **Label** (500, 0.75rem): column headers, view tabs, chips, pills, tags, form labels, nav group label, legend text. Sentence case, no tracking, never uppercase.
- **Mono** (400, 0.86em): inline `code` only, on a surface-2 chip with a 4px corner.

### Named Rules
**The Weight-Not-Size Rule.** Headings stay within 0.9375 to 1.375rem and separate by weight 600 and tighter tracking; the only large type is the ATS figure.

**The Tabular Figures Rule.** Every score, count, age, token total and table number sets with tabular figures so columns align.

## Layout

A two-column app shell: a sticky 240px sidebar (brand mark with next-scan time, ⌘K search button, Add a job, a "Workspace" nav group with counts on Jobs and Board, theme button and account at the foot) and a main column capped at 1280px with 22px/32px/56px padding. The sidebar ground and its right hairline run the full page height.

Pages open with a compact bar (min 48px): title, view tabs, a spacer, then a meta line of facts. Detail pages split into a flexible main column and a 320px sticky properties panel (96px label column). Two-up sections use an auto-fit grid of 360px minimum columns with 20px gaps. Sections sit 28px apart.

**Job list.** A single panel of status groups, each with a sticky 36px group head. Every row is its own grid with fixed columns (26px status, 42px match, flexible title, 92px sources, 48px ATS, 64px age, 176px actions) at 12px gaps, so pills align across groups. Between 861px and 1180px the sources column drops. At 860px and below each row becomes a two-line item (status, title and scores on line one; meta and actions on line two), the reason line and sources hide, and the shortcut legend disappears.

**Row actions.** On hover-capable screens wider than 860px the action cell (Tailor now, Resume, Apply) is transparent until the row is hovered, focused within, or holds the keyboard cursor; an in-progress "Tailoring" indicator always shows. On phones and touch screens the actions are always visible.

**Phones (≤860px).** The sidebar is replaced by a sticky header (brand, search, add, theme) and a fixed five-tab bottom bar (54px targets, safe-area padding). Main padding becomes 16px with 92px at the foot. Tables marked as entries become two-line grid items. Controls grow to 36px. The board stacks vertically. Usable at 360px without horizontal scroll.

**Board.** Horizontal columns of min 250px, 12px apart; on desktop the right edge fades over 56px to signal more columns.

### Named Rules
**The Fixed Columns Rule.** List rows share one fixed column template; never size a row's meta columns with auto widths.

**The Hidden-Until-Needed Rule.** Row actions appear on hover, focus or cursor on hover-capable desktops and are always shown on phones. Keyboard focus must always reveal them.

## Elevation & Depth

Depth is tonal: canvas, then sidebar, then surface-1, 2 and 3, each separated by a 1px hairline. Resting surfaces carry no shadow. Shadows appear only on layers that float above the page (command menu, chart tooltip, login card) and as a brief lift on hover for the primary button, act button and board cards. The aurora (a 16% violet radial at the top of the main column, 8% in light) is atmosphere, not elevation.

### Shadow Vocabulary
- **Pop** (`box-shadow: 0 16px 48px -12px rgb(0 0 0 / 0.7), 0 2px 8px -2px rgb(0 0 0 / 0.5)`; light: `0 16px 40px -12px rgb(20 20 40 / 0.22), 0 2px 6px -2px rgb(20 20 40 / 0.12)`): command menu, tooltip, login card.
- **Primary bevel** (`box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.16), 0 1px 2px rgb(0 0 0 / 0.3)`): the primary button at rest.
- **Hover lift** (`box-shadow: 0 6px 16px -6px rgb(0 0 0 / 0.55)`): primary and act buttons on hover.
- **Card lift** (`box-shadow: 0 8px 24px -12px rgb(0 0 0 / 0.6)`): board cards on hover.
- **Tab nub** (`box-shadow: 0 1px 2px rgb(0 0 0 / 0.25)`): the active view tab.
- **Focus halo** (`box-shadow: 0 0 0 3px` violet wash): inputs, selects and the status select on focus.

### Named Rules
**The Flat-At-Rest Rule.** Panels, lists and rows never cast shadows; a surface step and a hairline do the work. Shadows belong to floating layers and hover responses.

## Shapes

A strict radius ladder: 4px for code chips, skeletons and the score-bar track; 6px for pills, small buttons, nav items, view tabs and the focus outline; 8px for buttons, inputs, notices, board cards, tooltips and command items; 10px for panels, the job list and board columns; 12px for the command menu and the login card. Full rounding is reserved for chips, keyword tags, meters, the avatar and status circles. Every container has a 1px border; dashed borders mean "not yet" (fixable keywords, profile gaps, the New status ring, score-bar reference markers).

### Named Rules
**The Radius Ladder Rule.** Pills 6px, controls 8px, panels 10px, dialogs 12px. A larger container never takes a smaller radius than what it holds.

## Components

### Buttons
Compact and quiet until they are the next step.
- **Shape:** gently rounded (8px); small variant 6px at 28px tall.
- **Default:** surface-2 ground, strong hairline edge, primary text, 500 weight, 32px tall, 12px side padding, 6px icon gap.
- **Primary:** violet ground, white text, inner top highlight; used for the page's one commit (Apply for the cursor row, Save, Sign in).
- **Act ("Tailor now"):** violet wash with violet ink; on hover it fills solid violet and lifts.
- **Quiet:** transparent, secondary text; surface-2 on hover. Used for Dismiss, theme and sign-out.
- **Hover / Focus / Active:** surface-3 and control edge on hover; 2px violet outline at 2px offset on focus; a half-pixel press on active; 150ms transitions.
- **Disabled / Busy:** tertiary text on surface-2 with a plain hairline; busy buttons show a progress cursor and a verb ("Starting…", "Opening…").

### Pills (match, ATS, revision rounds)
- **Style:** 22px tall, 6px corners, strong hairline edge, surface-2 ground, 12px label weight 500, tabular figures.
- **Match pill:** primary text; scores 85+ take weight 700, a control edge and surface-3.
- **ATS pill:** "ATS" in tertiary then the figure; green wash at 90+, plain primary text at 80 to 89, red wash below 80, a dash when there is no resume.
- **Kept round:** violet wash and violet ink marks the revision that was kept.

### Chips and Keyword Tags
- **Filter chips:** full-round, 26px, surface-2 with a round 18px remove button.
- **Keyword tags:** full-round, 24px. Matched: primary text with a green check. Fixable (in profile, not yet on the resume): dashed violet edge, violet wash, violet ink. Gap (not in profile): dashed hairline, transparent, tertiary text, linking to Skills. Source tags carry an external-link icon.

### Cards / Containers
- **Corner Style:** 10px for panels, the job list and board columns; 8px for board cards.
- **Background:** surface-1 for panels; surface-2 for board cards.
- **Shadow Strategy:** none at rest (see Flat-At-Rest).
- **Border:** 1px hairline; board cards use the strong hairline.
- **Internal Padding:** 16px by 18px in panels; 10px by 12px in board cards.

### Inputs / Fields
- **Style:** surface-1 ground, strong hairline edge, 8px corners, 32px tall, 10px side padding, 13px text; selects carry a two-triangle caret; textareas grow vertically.
- **Focus:** the border turns violet with a 3px violet-wash halo; no outline.
- **Labels:** 12px weight 500 in secondary text above the field, hints in tertiary.

### Navigation
- **Sidebar:** 30px nav items, 6px corners, secondary text at 500; hover surface-2; active surface-3 with primary text and a violet icon. Counts sit right-aligned in tertiary tabular figures. A 12px "Workspace" group label precedes the list.
- **View tabs:** a segmented group on surface-1 with a hairline edge; 26px buttons, active tab on surface-3 with a hairline nub shadow, counts in tertiary.
- **Phone:** sticky header plus a fixed five-item bottom bar, 11px labels under 20px icons, active item in primary text with a violet icon.

### Status Icons (signature)
A progress-circle family drawn at 14px, one step further round the ring per status: New is a dashed tertiary ring; Shortlisted an empty secondary ring; Resume queued a half-filled amber ring; Resume ready a three-quarter green ring; Applied a filled violet-ink disc with a check; Interviewing a filled blue disc with a centre dot; Offer a filled green disc with a check; Rejected a filled red disc with a cross; Skipped and Archived a grey ring with a slash. In lists the icon itself is the status control: a native select is laid invisibly over it. The extension reproduces the family in CSS as 12px circles.

### Job Row (signature)
46px minimum, 5px by 14px padding, a hairline beneath. Title in primary text at 500, ellipsised; company and place on a tertiary line beneath. Hover and focus-within take surface-2 instantly (80ms linear). The keyboard cursor row takes surface-2 plus an inset 1px violet ring; there is no side stripe. The cursor row's Apply button is promoted to primary.
- **Evaluation flags:** only two, and only when they should stop you. A verdict of skip shows a 12px ban icon and "Do not apply" in red; a suspicious posting shows a shield icon and "Check posting" in amber. Both sit inline at the start of the company line, weight 500, 10px apart; ordinary rows carry no flag.

### ATS Score Bar (signature)
A 12px track on a true 0 to 100 scale. Earned parts are packed from the left in violet, one hairline between each contributing part (only parts that earned points draw). After them a hatched violet ghost shows the points the owner's profile could still add, up to the best honest score. The remaining empty track is what no honest resume can reach. Dashed reference markers stand at the 80 minimum (tertiary) and the 90 target (green), labelled above. The earned run fills once, on the first sight of a given resume in this browser. A legend and a parts list (earned and best honest per part) follow.

### Consumption Ledger
One running line of facts that wraps like text: a tertiary term, then the figure in primary at 600 tabular, then an optional small detail, each fact separated by a middot in the strong hairline colour. It replaces stat tiles.

### Command Menu (signature)
Opened with ⌘K (Ctrl K elsewhere) or the sidebar search button. A 620px dialog with 12px corners, strong hairline, pop shadow, over a dimmed overlay 12vh from the top; it fades in over 120ms and scales from 0.98 over 160ms. A 52px input row, grouped results (Go to, Actions, Jobs) with 38px items, the selected item on surface-3 with a violet icon and an "open"/"run" hint, and a foot legend of keycaps.

### Keycaps
20px keycaps with a 2px bottom edge, 5px corners, surface-2 ground, 11px secondary text: in the search button, the command menu and the Jobs shortcut legend.

### Chrome Extension
The popup (360px wide) and options page share the same neutral, violet and semantic roles, the same button, input and focus treatments, and Inter from a bundled variable woff2, on a slightly tighter ramp (30px controls, 12px labels, 17px/13px headings in the popup).

## Do's and Don'ts

### Do:
- **Do** keep dark as the default world and let light and "follow device" be opt-in choices remembered in localStorage.
- **Do** use one violet accent for focus, selection, the cursor and the next action; use violet ink (`violet-text`) whenever violet is text or an icon.
- **Do** draw single-series charts in series ink and give violet only to the hovered bar.
- **Do** set every figure in tabular numerals and keep body copy at 13px with labels at 12px.
- **Do** mark the keyboard cursor row with surface-2 and an inset 1px violet ring.
- **Do** keep job-row columns fixed (26, 42, flexible, 92, 48, 64, 176px) and drop sources between 861 and 1180px.
- **Do** show evaluation flags only for a skip verdict ("Do not apply", red) or a suspicious posting ("Check posting", amber), inline on the company line with an icon.
- **Do** show ATS on a true 0 to 100 scale with earned parts, a hatched reachable ghost, and the 80 and 90 markers.
- **Do** report figures as a running ledger line with middot separators rather than stat tiles.
- **Do** follow the radius ladder: pills 6px, controls 8px, panels 10px, dialogs 12px.
- **Do** keep transitions at 150ms ease-out and respect reduced motion by turning all animation off.

### Don't:
- **Don't** mark the cursor or a selected row with a coloured side stripe.
- **Don't** colour single-series chart bars violet at rest, or introduce extra series hues for one metric.
- **Don't** add evaluation flags, badges or colour to rows that need no action.
- **Don't** put shadows on resting panels, lists or rows.
- **Don't** use stat tiles or white-card admin dashboards to report numbers.
- **Don't** set labels in uppercase or with wide tracking.
- **Don't** use green, amber, red or blue decoratively.
- **Don't** choreograph page-load animation; only the command menu, skeleton shimmer and the first ATS fill move.
