---
name: Fairsheet
description: A job-hunt tracker drawn as an engineering sheet by day and a blueprint by night; every score dimensioned, every gap drawn as a hidden line.
colors:
  # Drawing sheet (light, default)
  page: "#f8fafc"
  rail: "#ecf1f5"
  surface-1: "#fcfeff"
  surface-2: "#eef3f7"
  rule: "#ccd2d7"
  rule-strong: "#393e43"
  control: "#7b8187"
  ink: "#1b2025"
  ink-2: "#43484e"
  ink-3: "#5f646a"
  accent: "#204ec3"
  accent-hover: "#103baf"
  accent-wash: "#dfecff"
  on-accent: "#ffffff"
  selection: "#c4d8ff"
  good: "#197037"
  good-wash: "#dcf7e1"
  warn: "#935a11"
  warn-mark: "#e8a127"
  warn-wash: "#feefcf"
  bad: "#b72725"
  bad-wash: "#ffe7e4"
  series-1: "#3463a6"
  # Blueprint (dark): its own steps, same roles
  blueprint-page: "#092c4f"
  blueprint-rail: "#042343"
  blueprint-surface-1: "#103356"
  blueprint-surface-2: "#1a3c60"
  blueprint-rule: "#3a5f7d"
  blueprint-rule-strong: "#c0d4e3"
  blueprint-control: "#7198b4"
  blueprint-ink: "#eff6fb"
  blueprint-ink-2: "#c7dbea"
  blueprint-ink-3: "#a7c2d5"
  blueprint-accent: "#f4d660"
  blueprint-accent-hover: "#ffe77d"
  blueprint-accent-wash: "#2b5074"
  blueprint-on-accent: "#032242"
  blueprint-selection: "#2a5885"
  blueprint-good: "#83e499"
  blueprint-good-wash: "#174a3b"
  blueprint-warn: "#ffb777"
  blueprint-warn-mark: "#ffb777"
  blueprint-warn-wash: "#513b21"
  blueprint-bad: "#ff9e9b"
  blueprint-bad-wash: "#5b3232"
  blueprint-series-1: "#379ecc"
typography:
  display:
    fontFamily: "Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1
    fontFeature: "tnum"
  headline:
    fontFamily: "Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 600
    lineHeight: 1.2
  title-sm:
    fontFamily: "Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.2
  wordmark:
    fontFamily: "Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.45
  body-sm:
    fontFamily: "Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
  control:
    fontFamily: "Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 500
    lineHeight: 1.2
  control-strong:
    fontFamily: "Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.2
  label:
    fontFamily: "Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "0.71875rem"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "0.07em"
  extension-body:
    fontFamily: "Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  none: "0px"
  control: "2px"
  balloon: "50%"
spacing:
  hair: "4px"
  tag-gap: "6px"
  control-gap: "8px"
  cell-y: "10px"
  cell-x: "12px"
  panel-y: "16px"
  panel-x: "18px"
  page-head: "20px"
  section: "28px"
  phone-gutter: "16px"
components:
  button:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "7px 14px"
    height: "36px"
  button-hover:
    backgroundColor: "{colors.surface-2}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.control-strong}"
    rounded: "{rounded.control}"
    padding: "7px 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-act:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.accent}"
    typography: "{typography.control-strong}"
    rounded: "{rounded.control}"
    padding: "7px 14px"
    height: "36px"
  button-act-hover:
    backgroundColor: "{colors.accent-wash}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
  button-quiet-hover:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
  button-small:
    typography: "{typography.body-sm}"
    padding: "4px 10px"
    height: "30px"
  button-disabled:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-3}"
  input:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
    height: "36px"
  segmented-pressed:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.control-strong}"
    height: "32px"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  nav-link-active:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.control-strong}"
  rail:
    backgroundColor: "{colors.rail}"
    width: "216px"
    padding: "20px 14px 16px"
  bottom-nav-item:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.ink-2}"
    height: "52px"
  panel:
    backgroundColor: "{colors.surface-1}"
    rounded: "{rounded.none}"
    padding: "16px 18px"
  title-block-cell:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "7px 14px 8px"
  table-header:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    padding: "9px 12px"
  table-cell:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "10px 12px"
  tag:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control}"
    padding: "4px 9px"
  tag-hidden-line:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
  notice:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    padding: "10px 14px"
  notice-error:
    backgroundColor: "{colors.bad-wash}"
    textColor: "{colors.ink}"
  notice-ok:
    backgroundColor: "{colors.good-wash}"
    textColor: "{colors.ink}"
  notice-pending:
    backgroundColor: "{colors.warn-wash}"
    textColor: "{colors.ink}"
  job-card:
    backgroundColor: "{colors.surface-1}"
    rounded: "{rounded.none}"
    padding: "10px 12px"
  status-mark:
    size: "10px"
    rounded: "{rounded.none}"
  balloon:
    textColor: "{colors.ink}"
    rounded: "{rounded.balloon}"
    size: "18px"
  meter:
    backgroundColor: "{colors.surface-2}"
    height: "8px"
  extension-button:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.extension-body}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
    height: "32px"
---

# Design System: Fairsheet

## Overview

**Creative North Star: "The Fair Sheet"**

Every job is a drawing sheet checked against its specification. The light theme is a cool white drawing sheet ruled in graphite with one ballpoint-blue hand for what the owner does; the dark theme is a blueprint, a Prussian-blue ground with white linework and a pale sodium-yellow hand. Both are the same drawing: one engineered grotesk set like drafting lettering, 1px rules at three weights, square corners, hatching for what was earned and dashed hidden lines for what is absent or still reachable. The fair sheet is the clean copy made from rough work, and the system keeps that promise visually: values are measured, tolerances are drawn, nothing is decorated.

Density is that of an observation table, not a card deck. Pages are ruled tables, ruled strips and flat panels set inside a double-rule sheet frame, with a single framed title block for scan metadata. Depth comes from line weight and two tonal steps, never from shadow; the only lifted object is a floating tooltip. Motion is limited to 180ms state changes and one signature draw: the ATS dimension line extends to its measured length the first time a browser sees a resume's score.

The world refuses the category default of rounded kanban cards with a bright accent and emoji badges, and it equally refuses the neon hacker terminal. Status is told by checking-ink marks that differ in shape as well as hue, so meaning survives without color.

**Key Characteristics:**
- Two complete token sets (drawing sheet, blueprint) with identical roles; dark is its own steps, not an inversion.
- One accent per theme, carried by the owner's hand: actions, selection, and what the owner did or can still do.
- Three line weights (rule, control, rule-strong) do the work that elevation does elsewhere.
- Square containers, 2px controls, and one circle: the drafting balloon.
- Drafting lettering (small tracked capitals) for data labels only; tabular figures for every comparable number.
- Dashed line means hidden, pending or still reachable, everywhere.

## Colors

A graphite-on-cool-white sheet (or white-on-Prussian blueprint) with one ink for the owner's hand and three checking inks with fixed meanings.

### Primary
- **Ballpoint Blue** (`accent`, light) / **Sodium Yellow** (`blueprint-accent`, dark): the owner's hand. Primary buttons, the outlined Tailor now action, the pressed segment, the active nav icon, focus rings, checkbox fill, the caret, the brand mark's check stroke, and the status marks for shortlisted (outline) and applied (fill). Dashed accent also draws what the owner can still add: fixable keyword tags and the reachable points in the ATS chain.
- **Pressed Ballpoint** (`accent-hover` / `blueprint-accent-hover`): hover on primary buttons only.
- **Accent Wash** (`accent-wash` / `blueprint-accent-wash`): the ground under an outlined action on hover and a board column while a card is dragged over it.
- **On Accent** (`on-accent` / `blueprint-on-accent`): text on the filled accent (white on blue, deep navy on yellow).

### Secondary
- **Checked Green** (`good`, `good-wash`): checked marks: tailored and interviewing/offer status marks, ATS on target, the minimum and target reference lines in the chain, matched-keyword check icons, success notices, healthy cells in the source-health grid.
- **Amber Pencil** (`warn`, `warn-mark`, `warn-wash`): pending. `warn` is the text-safe amber for the working label, the dashed tailor-queued mark and the pending notice border; `warn-mark` is a fill only (the meter at 20 to 40 percent left). In the light sheet `warn-mark` is 2.2:1 on surface-1, so it never carries text and never stands without a text value beside it.
- **Correction Red** (`bad`, `bad-wash`): corrections: ATS below 80, the rejected mark's strike, the Low flag, meters under 20 percent left, error notices and error text.

### Tertiary
- **Chart Ink** (`series-1` / `blueprint-series-1`): the single data series (token bars on Consumption). Validated for lightness band, chroma floor and 3:1 against the chart surface in both themes. It is the only series color.

### Neutral
- **Sheet White** (`page`) / **Prussian Ground** (`blueprint-page`): the page body and the scrollbar track.
- **Rail Tint** (`rail` / `blueprint-rail`): the left rail, the phone header and the bottom bar.
- **Sheet Surface** (`surface-1`): panels, tables, title block, inputs, default buttons, tags, job cards, the active nav item.
- **Wash Surface** (`surface-2`): hover rows, quiet hover, disabled controls, info notices, skeleton bars, meter track, chart cursor.
- **Hairline** (`rule`): row rules, panel borders, cell dividers. Decorative separator (about 1.5:1), never the boundary of an operable control.
- **Control Line** (`control`): the border of anything operable (buttons, inputs, selects, segmented groups, tags) and the scrollbar thumb. At least 3.7:1 against page and surfaces in both themes.
- **Heavy Line** (`rule-strong`): the sheet frame, the title block, table header underlines, and the top rule of ledgers, filter strips and the board.
- **Graphite Ink** (`ink`, `ink-2`, `ink-3`): primary text; secondary text, labels and hatching; muted metadata and placeholders. All three pass 4.5:1 on page, surface-1, surface-2, rail and accent-wash in both themes.
- **Selection** (`selection`): text selection ground.

### Named Rules

**The Ballpoint Rule.** The accent is the owner's hand: actions, selection, focus, and marks for what the owner did or can still do. It never colors a heading, a decorative fill or a checking meaning (good, pending, bad).

**The Checking Ink Rule.** Green checked, amber pending, red correction; each has a wash for grounds. A checking ink is always paired with a shape (filled, dashed, ringed, struck) or a word, never hue alone.

**The Two Sheets Rule.** Every color token exists in both sets. The dark set is declared twice: under `prefers-color-scheme: dark` guarded by `:root:not([data-theme="light"])`, and under `:root[data-theme="dark"]`. A token added to one sheet and not the other is a defect.

## Typography

**Display Font:** Barlow (with Segoe UI, system-ui, sans-serif)
**Body Font:** Barlow
**Label Font:** Barlow, set as drafting lettering

**Character:** One engineered grotesk at four weights (400, 500, 600, 700), self-hosted. Its narrow, drafted forms read like the lettering on a title block; hierarchy comes from weight and size steps, not from a second family.

### Hierarchy
- **Display** (600, 2.25rem, 1, tabular): the ATS figure on the job page. One per page.
- **Headline** (600, 1.5rem, 1.2, -0.01em): the page h1, balanced wrapping.
- **Title** (600, 1.1875rem, 1.2): section and panel h2.
- **Title Small** (600, 1rem, 1.2): h3 and empty-state titles. Group headings inside panels drop to body-sm in ink-2, sentence case.
- **Wordmark** (700, 1.1875rem): "Fairsheet" beside the sheet mark in the rail and phone header. Nowhere else.
- **Body** (400, 0.9375rem, 1.45): all running text; paragraphs cap at 72ch, reasons at 60ch.
- **Body Small** (400, 0.8125rem): metadata, hints, tags, small buttons, legends, chart ticks (12px).
- **Control** (500, 0.9375rem, 1.2): buttons and nav links; 600 for primary, act, active nav and the pressed segment.
- **Label** (600, 0.71875rem, 0.07em, uppercase): drafting lettering for table headers, title-block and ledger terms, and board column statuses.
- **Extension** (400, 13px, 1.45): the popup's compact ramp (12px small, 16.5px h2, 21px h1); the options page lifts it to 14px body, 18px h2, 24px h1.

### Named Rules

**The Drafting Lettering Rule.** Small tracked capitals label data: a column, a term, a column status. They never sit above a heading as an eyebrow, and headings themselves stay in sentence case.

**The Tabular Figures Rule.** Every number a reader compares (scores, counts, tokens, money, dates in the title block, revision rounds) is set with `font-variant-numeric: tabular-nums`. Tables inherit it.

## Layout

The desktop shell is a 216px rail (`rail` tint, 1px `rule` right edge, sticky, full height) beside the sheet. The sheet pads 24px 28px 40px and centers its content at a 1320px maximum. From 861px up, the content sits inside the sheet frame: a 1px `rule-strong` border plus a 1px `rule-strong` outline offset 4px (the trim line), padded 24px 28px 36px. The Jobs title block is set into the frame's top-right corner, the way a drawing's title block sits in its corner.

Pages follow one rhythm: a page head (h1, a one-line lede in ink-2, the primary actions at the right) with 20px below it, then sections spaced 28px apart. Two-column pages use a 1.35fr / 1fr split or auto-fit columns with a 360px minimum, both with 28px gaps. Inside panels: 16px 18px padding. Table cells: 10px 12px; headers 9px 12px. Tags and chips gap 6px; controls in a row gap 8px.

Filters live in a single ruled strip (heavy rule above, hairline below, 10px vertical padding), not a boxed toolbar. Summaries that are not the title block are ledgers: auto-fit 160px cells between a heavy top rule and a hairline bottom rule, no box.

At 860px and below the rail disappears: a sticky phone header in the rail tint carries the wordmark, Add, theme and sign-out; a fixed five-item bottom bar (52px minimum targets, safe-area padding) names the sheets. The sheet gutter becomes 16px with 88px bottom clearance. The frame drops away. The title block stretches to four equal columns and hides its sub-values. Observation tables marked as entries reflow into two-line ruled entries: role and status on the left, scores and the next action on the right. Secondary filters fold behind a Filters toggle. Nothing scrolls horizontally at 360px except a wide table inside its own scroll wrapper.

### Named Rules

**The One Title Block Rule.** A sheet carries at most one framed metadata box, the title block. Every other summary is a ledger or a ruled strip.

**The Next Action Rule.** In any row of jobs, the one next action (Tailor now, Resume, Apply) sits at the right edge, right-aligned, on desktop and phone alike.

## Elevation & Depth

Fairsheet is flat. Depth is conveyed by three line weights and two tonal steps: page to surface-1 (raised a hair lighter in light, a step lighter in dark) and surface-2 for hover and quiet grounds. The rail is its own tint. The active nav item is marked with a 1px inset ring in `rule`, which is a line drawn with `box-shadow`, not elevation.

### Shadow Vocabulary
- **Floating layer** (`box-shadow: 0 4px 16px rgb(0 0 0 / 0.14)`): the chart tooltip, the one element that floats above the sheet. It also carries a 1px `rule-strong` border.

### Named Rules

**The Flat Sheet Rule.** Panels, cards, buttons, notices and the title block never cast shadows. Only a layer that floats over content (a tooltip, a popover) takes the floating-layer shadow.

**The Three Line Weights Rule.** `rule` separates, `control` bounds what can be operated, `rule-strong` frames and heads. Pick the weight by role, never for emphasis.

## Shapes

The form language is the drawing sheet's: square containers, near-square controls, 1px lines, and 1.5px strokes for marks and the dimension chain. Panels, tables, the frame, the title block, job cards, notices, skeleton bars, meters and board columns have square corners (0). Operable controls (buttons, inputs, selects, segmented groups, tags, nav links) take a 2px corner. Chart bars take 2px on their top corners only. The one circle is the balloon, the drafting item-number mark that ties a chain segment to its row in the parts table.

Dashes carry meaning: a dashed line is hidden, pending or still reachable (hidden-line tags for skills not in the profile, the best-honest extension of the dimension line, reachable points in the chain, the tailor-queued mark, the pending notice). Hatching (135deg, 1.5px ink-2 lines every 6px) means earned. These two devices are the only patterned fills.

**The 2px Ceiling Rule.** No corner exceeds 2px except the balloon's circle. No pills, no rounded cards.

## Components

### Buttons
Tactile but drafted: a 1px line, a 2px corner, no lift.
- **Shape:** 2px corners (`rounded.control`), 36px minimum height, 7px 14px padding, 6px icon gap, weight 500.
- **Default:** surface-1 ground, ink text, `control` border. Hover: surface-2 ground and an ink-2 border. Active: `rule` ground.
- **Primary:** filled accent with on-accent text, weight 600; hover moves to accent-hover. Used for Apply on the job page, Sign in, Save job and Add top-up.
- **Act (outlined accent):** surface-1 ground, accent border and text, weight 600; hover lays down accent-wash. This is Tailor now, the per-row next action.
- **Quiet:** transparent, ink-2 text; hover surface-2 with ink text. Dismiss, theme toggle, sign out.
- **Small:** 30px minimum height, 4px 10px padding, body-sm. The size used inside table rows.
- **Disabled / busy:** surface-2 ground, ink-3 text, `rule` border, not-allowed cursor; busy buttons set `aria-busy` and change their label ("Starting…").
- **Focus:** a 2px accent outline offset 2px, global for every focusable element.
- **Transitions:** background, border and color at 180ms on `cubic-bezier(0.16, 1, 0.3, 1)`.

### Segmented control
A single `control`-bordered group with 2px corners; segments separated by hairlines, 32px tall. The pressed segment fills with accent and on-accent text at 600. Used for time ranges on Consumption.

### Tags
- **Style:** 1px `control` border, 2px corner, surface-1 ground, body-sm, 4px 9px padding, 6px gap between tags. Link tags darken their border to ink on hover.
- **Matched:** a green check icon before the keyword.
- **Fixable:** dashed accent border (in the profile, not yet on the resume).
- **Hidden line:** dashed `control` border, transparent ground, ink-2 text (not in the profile; links to Skills).
- **Low flag:** bad border and text with an alert icon.

### Cards / Containers
- **Corner Style:** square (0).
- **Background:** surface-1 on the page.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px `rule`.
- **Internal Padding:** 16px 18px for panels; 10px 12px for board job cards.
- **Nesting:** a panel holds tables, ledgers and tag groups; it never holds another panel. A table that fills a panel sits flush inside it with no inner padding.

### Inputs / Fields
- **Style:** surface-1 ground, 1px `control` border, 2px corner, 6px 10px padding, 36px minimum height; textareas 96px minimum (260px on Add job), vertical resize, 1.5 line height. Placeholders in ink-3 at full opacity.
- **Hover:** border moves to ink-2.
- **Focus:** the global 2px accent outline.
- **Field:** label above in body-sm ink-2 at 500, hint below in body-sm ink-3, 5px gaps. Checkboxes are 16px with accent fill.
- **Flat select:** inside table rows the status select is borderless until hover or focus, then shows the `control` border on surface-1.
- **Error:** error text in `bad` at body-sm under the control; page-level errors use the error notice.

### Navigation
- **Rail (desktop):** the wordmark with the sheet mark, then five sheet links (Jobs, Board, Skills, Consumption, Runs) with 16px icons, 8px 10px padding, 2px corners, weight 500 in ink-2. Hover: surface-2 and ink. Active: surface-1 ground, ink text at 600, a 1px inset `rule` ring and the icon in accent. The rail foot holds Add a job (default button, full width), the theme toggle, the signed-in email and sign out.
- **Bottom bar (phone):** five equal cells, 20px icons over 0.75rem labels, 52px minimum height, `rule-strong` top line. Active: surface-1 ground, ink at 600, accent icon.

### Notices
A flat strip, 10px 14px, 1px border, 10px gap, 16px below. Info: surface-2 with a `rule` border. Error: bad border on bad-wash with an alert icon, `role="alert"`. Ok: good border on good-wash. Pending: dashed warn border on warn-wash. Text stays ink in every kind.

### Observation table
The main body of every list page. Full-width, collapsed borders, tabular figures. Headers are drafting lettering in ink-2 over a 1px `rule-strong` underline, on surface-1. Cells are 10px 12px, top-aligned, separated by hairlines; the last row has none. Row hover lays down surface-2. The role cell is a 600-weight title link (underline on hover) over the company in ink-2 and a 60ch reason in ink-3. Numeric columns right-align. On phones the table reflows into two-line ruled entries (see Layout).

### Title block (signature)
The one framed metadata box: a 1px `rule-strong` frame on surface-1 holding four cells split by hairlines, each with a drafting-lettering term in ink-3 over a 600-weight tabular value (last scan, next scan, new since last visit, resumes left today). It sits in the frame's top-right corner on desktop and becomes a full-width strip on phones.

### Status marks (signature)
A 10px square beside the status word, stroked at 1.5px, distinguished by shape as well as ink: new is a hollow ink-2 square; shortlisted a hollow accent square; tailor queued a dashed amber square; tailored a filled green square; applied a filled accent square; interviewing and offer a filled green square with a second ring 1.5px out; rejected a red square struck through by a diagonal; skipped and archived a filled hairline-grey square. In-progress work shows the working label: an amber dashed square turning once every 2.4s beside amber body-sm text.

### ATS dimension chain (signature)
The ATS breakdown drawn as a dimension on a part. Above, a 1.5px ink dimension line with arrowheads runs from 0 to the measured score, its value lettered at the midpoint on surface-1; a dashed ink-2 extension continues to the best honest score, labeled in ink-3. Below it, a 30px bar framed at 1.5px ink is divided into the seven parts by width (required 45, preferred 15, title 10, experience 10, education 5, placement 5, format 10); each part is hatched as far as it scored, reachable points are boxed in dashed accent, and empty space means not in the profile. Dashed green verticals mark the 80 minimum and 90 target. Extension lines drop from every boundary to a balloon, the short label and the measured value; on phones only the balloons remain. A legend names each device. The dimension line draws once (520ms, scaleX from the left) the first time a browser sees that resume's score; after that it is simply drawn.

### Balloons
An 18px circle with a 1px ink-2 line and a 600 tabular 11px numeral, numbering the chain's parts and the matching rows of the parts table (15px on phones).

### Meter
A square-ended 8px bar on surface-2 with a hairline frame, 110px minimum. The fill is ink-2; amber (`warn-mark`) when 20 to 40 percent is left, red under 20 percent. It is a `role="meter"` with a spoken label, always beside the numbers it summarizes.

### Board
Status columns in a grid of 220px minimum, joined by hairlines under a heavy top rule, no column boxes. Each column head is the status mark in drafting lettering with a tabular count, over a hairline. Job cards are square, flat, surface-1 with a hairline border that darkens to `control` on hover; they carry the title link, company, and a meta line of place, match and ATS. A column under a dragged card takes accent-wash.

### Source health grid
A grid of 24 by 22px square cells, 3px apart, one per source per run: green, amber or red ink on its wash with a matching border, or surface-2 with ink-3 when skipped. Each cell carries a lucide icon so state is readable without hue, and is focusable with a spoken label.

### Chart
Recharts bars in `series-1`, 24px maximum width, 2px top corners, no animation. Horizontal grid lines in `rule`, the x-axis line in `rule-strong`, ticks in ink-3 at 12px, no tick marks. The hover cursor is a surface-2 band; the tooltip is the floating layer.

### Icons
lucide-react at 16px with a 1.75 stroke, `aria-hidden`, always beside a text label or inside a labeled control (14px inside tags and small links, 20px in the bottom bar). The brand mark is a custom SVG: a double-framed sheet with a title-block corner and a check stroke in accent.

### Chrome extension
The same tokens on a compact ramp. The popup is 360px wide, 14px 16px padded, headed by the sheet mark and wordmark over a heavy rule; each task is a block separated by hairlines. Buttons are 32px tall with 6px 12px padding at 600 (quiet at 500), with the same default, primary, act and quiet variants; inputs are 32px with 6px 8px padding. Job entries are hairline-bordered surface-1 blocks. Status marks use the same square vocabulary. Dark follows the OS only.

## Do's and Don'ts

### Do:
- **Do** use `var(--token)` for every color and define any new token in both the drawing-sheet and blueprint sets.
- **Do** bound operable controls with `control` (#7b8187 light) and separate content with `rule`; frame and head with `rule-strong`.
- **Do** keep the accent for the owner's hand: primary and next actions, selection, focus, and what the owner did or can still add.
- **Do** draw anything hidden, pending or still reachable with a dashed line, and anything earned with the 135deg hatch.
- **Do** set every comparable number in tabular figures and every data label in drafting lettering (0.71875rem, 600, uppercase, 0.07em).
- **Do** put each job's single next action at the right edge of its row, as an act button (Tailor now), a small Resume button or Apply.
- **Do** keep state transitions at 180ms on `cubic-bezier(0.16, 1, 0.3, 1)` and switch every animation off under `prefers-reduced-motion`.
- **Do** pair every checking ink with a shape, icon or word so status reads without color.
- **Do** reflow tables into two-line ruled entries at 860px and below instead of scrolling the page sideways.

### Don't:
- **Don't** round containers or give any control more than a 2px corner; the balloon is the only circle.
- **Don't** add shadows to panels, cards, buttons or notices; the floating-layer shadow belongs only to layers that float over content.
- **Don't** put a panel inside a panel, or frame a second metadata box on a sheet that already has a title block.
- **Don't** use the accent to mean good, pending or bad, or to color headings and decorative fills.
- **Don't** set `warn-mark` as text or let it carry meaning alone; it is a fill beside a value.
- **Don't** place drafting lettering above a heading as an eyebrow or kicker.
- **Don't** add page-load choreography; the dimension line's single draw and the working mark's turn are the only animations.
- **Don't** introduce a second chart hue without validating it against the chart surface in both themes; `series-1` is the only series.
- **Don't** add gradients beyond the two drafting fills (the earned hatch and the rejected mark's strike).
