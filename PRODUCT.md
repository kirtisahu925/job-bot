# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A software engineer job-hunting in India (the first user targets Java backend SDE-2 roles; Python backend and full-stack JS are secondary tracks). Each person runs their own copy: their own repository, master profile, Supabase project and login, so the product never assumes one particular person. They open it after each scheduled scan (10:00 and 22:00 IST) on a laptop, and from a phone in between. The job: triage new matches, tailor a resume for the good ones, check its ATS score, apply, track the application, and see which skills the market keeps asking for.

## Product Purpose

Scans Indian job boards twice a day, scores each job against the owner's profile, tailors a one-page LaTeX resume per job, scores that resume the way a keyword ATS would, and helps apply (Chrome extension autofill). Success is moving from "new match" to "applied" quickly with a resume that reaches ATS 80+ (target 90), and knowing exactly which skills are the gap when it cannot.

## Positioning

Honest match, fast apply. Every tailored resume is built only from the owner's master profile: it may reword, reorder and emphasise, but never claims a skill or result the profile does not contain. When the ATS score is held back, the product says which missing skills cap it and turns them into a learning list instead of inventing them. Speed matters, honesty wins when they conflict.

## Operating Context

- Scans run on GitHub Actions at 10:00 and 22:00 IST; results land in Supabase and the dashboard.
- "Tailor now" runs a GitHub Action for one job (about 3 minutes) and returns a PDF plus an ATS breakdown.
- The Chrome extension autofills application forms, attaches the tailored PDF, saves jobs seen while browsing, and never submits.
- Consumption: free API tiers first (Gemini, JSearch, Apify, Adzuna); token use, money spent and remaining balances are tracked.
- Used in two sittings a day on a laptop, plus quick checks on a phone.

## Capabilities and Constraints

- Pages: Jobs (list), Board (status columns), Job detail (score, JD, tailored resume, ATS panel), Consumption, Runs, Skills (current skills vs gaps / skills to learn), Add job, Login.
- Statuses: new, shortlisted, tailor_queued, tailored, applied, interviewing, offer, rejected, skipped, archived.
- ATS score out of 100 with breakdown: required skills 45, preferred 15, title 10, experience 10, education 5, placement 5, format 10. Minimum 80, target 90. Reports matched, fixable (in profile but missing from the resume) and gap (not in profile) keywords, rounds, and the best honest score.
- Skill statuses the owner can set: To learn, Learning, I know this, Ignore.
- Single-owner access: Supabase Auth login, row-level security limits every row to the owner. Sign-ups are off.
- Stack is fixed: React 18 + Vite + TypeScript dashboard on Cloudflare Pages; Chrome MV3 extension in plain HTML/CSS/JS; charts with recharts.
- Product name: undecided; the current placeholder is "Job Tracker". The name is chosen during the visual direction step.

## Evidence on Hand

- Demo data in `dashboard/src/lib/demo.ts` (jobs, runs, usage, balances) for screenshots and development.
- A real master profile in `profile/master_profile.yaml` and a sample Java backend JD in `tests/fixtures/jd_java_backend.txt`.
- No testimonials, users, or metrics exist; none may be invented.

## Product Principles

1. Never fabricate: no invented skills on resumes, no invented numbers in the UI. Show what is known and say what is missing.
2. The next action is always obvious: for any job, the one thing to do next (tailor, review, apply, follow up) is findable in seconds.
3. Scores explain themselves: every score shows what raised it and what holds it back.
4. Gaps become a plan: a missing skill is a learning item ranked by how often jobs ask for it, not a failure.
5. Cost is visible: tokens, money and remaining free quota are never hidden.

## Accessibility & Inclusion

WCAG 2.1 AA contrast and full keyboard use. Usable at phone width (360px) without horizontal scrolling. Light and dark themes, following the OS by default.
