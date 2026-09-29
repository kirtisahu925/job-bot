# SDE Job Bot · Fairsheet

Scans job sites twice a day (10:00 and 22:00 IST), scores every new job against your profile, writes a
one-page tailored LaTeX/PDF resume for the best matches using the **LLM Resume Generation & Tailoring
Framework** (`prompts/framework.md`), scores each resume the way a keyword **ATS** reads it (minimum 80,
target 90), and puts it all on **Fairsheet**, a dashboard where you tailor on demand, track applications
and see which skills to learn. A Chrome extension fills in application forms and attaches the tailored
PDF. **Nothing ever applies or submits on your behalf, and no resume ever claims a skill your profile
does not list.**

```
GitHub Actions (10:00 & 22:00 IST) ──► python -m jobbot run
  fetch    LinkedIn · Indeed · Naukri (python-jobspy) · Foundit · Wellfound (Apify)
           Adzuna · JSearch · Remotive · Jooble · Greenhouse/Lever/Ashby company boards
  filter   dedupe across sites → title / location / experience rules → skill-overlap ranking
  score    Gemini Flash-Lite, 8 jobs per request, also extracts required / preferred skills
  tailor   Gemini Flash: framework → JSON → LaTeX → pdflatex → one full page
  ats      score the PDF text (0–100) → revise up to twice toward 90 → keep the best honest version
  record   tokens, cost, quotas and balances for every provider
      ▼
Supabase (Postgres + private PDF storage + login + tailor-now Edge Function)
      ▲                                         ▲
Fairsheet dashboard                        Chrome extension
Jobs · Board · Skills · Add job ·          Save job · Tailor now · Autofill ·
Consumption · Runs · Tailor now            Attach resume · Mark applied
      │ Tailor now
      ▼
tailor-now Edge Function ──► GitHub Actions "Tailor now" workflow (about 3 minutes)
```

| Folder | What it is |
|---|---|
| `jobbot/` | The Python bot (sources, pipeline, LLM ledger, tailoring engine, `ats/` scoring, stores, CLI) |
| `config/` | `search.yaml` (roles, cities, filters, ATS target), `skills_synonyms.yaml`, `companies.yaml`, `pricing.yaml` |
| `prompts/` | Your framework verbatim, plus the scoring and output-contract prompts |
| `templates/resume.tex.j2` | Single-column ATS-safe LaTeX template with the Rule 3 preamble |
| `profile/master_profile.yaml` | Your master resume: the only source of facts for every tailored resume |
| `supabase/` | `migrations/` (database, security rules, storage, views) and `functions/tailor-now/` |
| `dashboard/` | Fairsheet, the React + Vite site (host on Cloudflare Pages) |
| `extension/` | Chrome extension (Manifest V3, no build step) |
| `extension-tests/` | Unit and browser tests for the extension |
| `PRODUCT.md`, `DESIGN.md`, `.impeccable/`, `.claude/skills/impeccable/` | Design records and the [impeccable](https://github.com/pbakaus/impeccable) design skill (see "Design") |

---

## APIs used and what they cost

### Job sources

LinkedIn, Indeed, Naukri, Foundit and Wellfound have **no public job-search API**. The bot reads their
public listings **without logging in** (so your accounts are never at risk), in small volumes, twice a
day. This is unofficial and against those sites' terms; it can break when a site changes, and LinkedIn
and Naukri in particular may block GitHub's datacenter IPs. Each source fails on its own without
stopping the run, its health is shown on the dashboard, and two fallbacks cover the gaps: JSearch (Google
for Jobs, which carries LinkedIn/Indeed/Naukri listings) and the extension's **Save job** button.

**LinkedIn search filters.** `sources.linkedin` in `config/search.yaml` holds the filters of a LinkedIn
search URL, so the bot searches like
`linkedin.com/jobs/search-results/?keywords=Back End Developer&geoId=102713980&distance=0&f_TPR=r86400`:
`queries` (keywords), `location` and `geo_id` (India is 102713980), `distance`, `hours_old` (24 is
`f_TPR=r86400`, the past 24 hours), and `params` for any other filter as is (`f_E: "2,3"` for entry and
associate level, `f_WT: "1,3"` for on-site and hybrid). To copy a search, run it on linkedin.com and read
the values from the address bar. `f_JIYN` (jobs in your network) only works when signed in to LinkedIn, and
the bot reads public listings without logging in, so it is left out.

| Source | How | Cost | Secret |
|---|---|---|---|
| LinkedIn, Indeed, Naukri | [python-jobspy](https://github.com/speedyapply/JobSpy) | Free | – |
| Foundit | Its own search JSON (unofficial, **experimental**) | Free | – |
| Wellfound | An Apify actor, paid per result | ≈ $1–3/month, inside Apify's **$5/month free credit** | `APIFY_TOKEN` |
| Adzuna | Official API (India) | Free key | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` |
| JSearch (RapidAPI) | Official API over Google for Jobs | 200 requests/month free (bot stops at 190) | `RAPIDAPI_KEY` |
| Greenhouse / Lever / Ashby | Official public board APIs, companies you list | Free | – |
| Remotive, Jooble | Official APIs | Free (Jooble key on request; off by default) | `JOOBLE_API_KEY` |

Any of the five unofficial sites can be moved to an Apify actor (`method: apify` in `config/search.yaml`)
if its free scraper gets blocked.

### LLM and platform

| Service | Used for | Free tier | Secret |
|---|---|---|---|
| **Gemini API** | Scoring (Flash-Lite) and tailoring (Flash) | No card. Roughly ~500 requests/day on Flash-Lite and ~20/day on Flash; Google changes these without notice, so set your real caps in `config/pricing.yaml`. Free-tier prompts may be used by Google to improve its products; your contact details are never sent. | `GEMINI_API_KEY` |
| **Supabase** | Database, PDF storage, login | 500 MB database, 1 GB files. Pauses after 7 idle days; the bot keeps it active. | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| **Cloudflare Pages** | Hosts the dashboard | Free, works with private repos | – |
| **GitHub Actions** | Runs the bot on schedule | 2,000 minutes/month on private repos; the bot uses ~6 minutes a run (~360/month) | – |
| **Claude API** (optional upgrade) | Better tailoring | No free tier | `ANTHROPIC_API_KEY` |

### Token consumption

Per scheduled run: scoring about 34k input / 5k output tokens, plus one tailored resume. A resume costs
**up to three Gemini Flash requests** (the first draft and up to two ATS revision rounds), about 6–9k input
and 3–5k output tokens each, thinking included. Every Tailor now press costs the same as one resume.
**On the Gemini free tier this costs $0.** The free tier allows about 18 Flash requests a day, so about
six resumes a day: two from the schedule (`limits.tailor_per_run: 1`) and about four from Tailor now.

If you switch to Claude later (`llm.provider: anthropic` in `config/pricing.yaml`), the Consumption page
already shows what your real usage would cost on the model named in `shadow_model` ("Would cost on a paid
model"), so you can decide with your own numbers instead of an estimate.

### Balance and usage tracking

Every LLM call and every source call is recorded (tokens in/out/thinking, requests, cost, status). The
**Consumption** page shows tokens today and this month, money used, and a **current balance** for each
service:

| Service | Current balance comes from |
|---|---|
| Gemini free tier | Requests left today per model (your cap minus requests since midnight Pacific, 12:30 IST) |
| Apify | Live from Apify's `/users/me/limits`: this month's usage against your monthly credit |
| JSearch | Live from RapidAPI's remaining-requests header |
| Adzuna, Jooble | Calls today against the daily cap in `config/search.yaml` |
| Claude | Anthropic has **no balance API**: record each credit purchase on the Consumption page ("Credit top-ups"); balance = top-ups − spend the bot recorded. Optional monthly budget in `pricing.yaml` too. |

The bot stops calling a model or API when its cap, budget or balance is reached; a rate-limited Gemini
model falls back to the next one in `tailor_models`; untailored jobs wait for the next run.

---

## Setup (about 30 minutes, once)

Each person runs their own copy: fork or copy this repository (keep it **private**, since your profile is
in it), then follow these steps with your own accounts.

### 1. Get the free keys

- **Gemini**: https://aistudio.google.com → Get API key.
- **Adzuna**: https://developer.adzuna.com → register → App ID + App Key. The form asks for an
  organisation: a personal project is fine (for example "Your Name (personal job-search project)" and your
  GitHub profile URL as the website).
- **JSearch**: https://rapidapi.com → subscribe to *JSearch* on the free *Basic* plan → copy your
  **RapidAPI key** (`X-RapidAPI-Key` on the endpoint page). `job_id` is a request field, not a key.
- **Apify** (Wellfound): https://apify.com → free account ($5 monthly credit) → Settings → API token.
  Open the Wellfound actor named in `config/search.yaml` (`sources.wellfound.actor_id`), check its **Input**
  tab, and make `sources.wellfound.input` match it (`{query}` is replaced with each search). Or set
  `enabled: false`.
- Optional: **Jooble** key (https://jooble.org/api/about), then set `sources.jooble.enabled: true`.

Never paste keys into chats, issues or commits. They go in GitHub secrets (step 4) and, for running on
your laptop, in a git-ignored `.env` file (copy `.env.example`).

### 2. Create the Supabase project

1. https://supabase.com → New project. Signing in to supabase.com with GitHub only affects that website;
   the dashboard and extension use a separate login you create in step 2.4.
2. Open `supabase/migrations/0002_owner_ats_skills.sql` and put **your** email in the `app_owner` line.
3. SQL Editor → run `0001_init.sql`, then `0002_owner_ats_skills.sql`, then `0003_advisor_fixes.sql`
   (all three are safe to re-run). With the Supabase connector in Claude, it can apply them for you.
4. Authentication → Users → **Add user** with that email and a password, "Auto confirm" on. This is your
   dashboard and extension login. Then Authentication → Sign In / Providers → turn **off** "Allow new users
   to sign up".
5. Deploy the Tailor now function: `supabase functions deploy tailor-now` (Supabase CLI) or ask Claude
   with the Supabase connector. Keep "Verify JWT" on.
6. Project Settings → API keys: note the **Project URL**, the **anon** or publishable key (safe in
   browsers, because row-level security limits every row to your login) and the **service_role** or secret
   key (GitHub secrets only). The database password and connection string are never needed.

### 3. Your master profile

`profile/master_profile.yaml` is committed (keep the repository private). Replace its contents with your
real history. Everything the tailored resumes say comes from here: the LLM may reword and reorder, but
facts, dates and employers are copied from this file, a skill it doesn't list is never added, and
`allowed_titles` lists the only headlines a resume may use. Bullets read best at 100–113 or 205–226
characters.

### 4. Add GitHub secrets

Repository → Settings → Secrets and variables → Actions → New repository secret:

`GEMINI_API_KEY`, `RAPIDAPI_KEY`, `APIFY_TOKEN`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and optionally `JOOBLE_API_KEY`, `ANTHROPIC_API_KEY`.

The first step of every scan and Tailor now run checks them: a missing `GEMINI_API_KEY`, `SUPABASE_URL` or
`SUPABASE_SERVICE_ROLE_KEY` stops the run with an error naming the secret; a missing source key (JSearch,
Apify, Adzuna) only skips that source, with a warning on the run page.

### 5. Connect Tailor now to GitHub

1. GitHub → Settings → Developer settings → Fine-grained personal access tokens → Generate: repository
   access **only this repository**, permission **Actions: Read and write**, nothing else.
2. Supabase → Edge Functions → Secrets → add `GH_DISPATCH_TOKEN` with that token. (Optional: `GH_REPO`
   if your copy is not `ankit-shilarkar/sde-job-bot`, `GH_REF` if your default branch is not `main`.)

Without the token, Tailor now still marks the job as queued and the next scheduled run tailors it.

### 6. Turn on the schedule

GitHub only runs scheduled workflows from the **default branch**: Settings → General → Default branch →
`main`. Then Actions → **Job scan** → Run workflow to test it right away. Each run's summary (sources,
tokens, ATS scores, balances) appears on the run page. Scheduled runs can start 5–20 minutes late when
GitHub is busy.

### 7. Deploy the dashboard (Cloudflare)

`dashboard/.env.production` holds the Supabase Project URL and anon key the site is built with (public
values: the anon key ships in every browser bundle, and row-level security limits every row to your login).
In your own copy, replace them with your project's. `dashboard/.nvmrc` pins Node 22.

The site is a Cloudflare **Worker** that serves the built files (`dashboard/wrangler.jsonc`: assets from
`dist`, with single-page-app routing so links like `/jobs/<id>` open directly).

Cloudflare → Workers & Pages → Create → Import a repository → authorize GitHub → this repository. Project
name `fairsheet`, then under Build: **root directory `dashboard`**, build command `npm run build` (or
empty: wrangler builds it anyway), deploy command **exactly `npx wrangler deploy`**. Do not add
`--assets=…` to it: that overrides `dist` and serves the unbuilt source, and the page then says "could not
load …/src/main.tsx". No environment variables are needed. After it is created, Settings → Build →
Branch control → **production branch `main`** (and optionally turn off builds for other branches). The site
is `https://fairsheet.<your-account>.workers.dev`; every push to `main` redeploys it. Sign in with the user
from step 2.4. (Try it first without Supabase: `cd dashboard && npm install && VITE_DEMO=1 npm run dev`
shows sample data.)

### 8. Install the Chrome extension

Chrome only installs an unpacked **folder**; dropping a zip on the page does nothing. Download
`fairsheet-extension` from the latest CI run's artifacts (or use the `extension/` folder of your clone),
unzip it, then `chrome://extensions` → Developer mode → **Load unpacked** → pick the unzipped folder.
Open its options: paste the Supabase URL and anon key, sign in, fill your application profile (CTC,
notice period, links…), add answers to recurring questions (`keywords => answer`), and upload a default
resume.

On a job page on LinkedIn/Indeed/Naukri/Foundit/Wellfound a **Save job** button appears. The popup shows
the job's match and ATS score and a **Tailor now** button. On an application form, click the extension →
**Autofill this page**: it fills recognised fields (outlined in green), attaches the tailored PDF for that
job (or your default resume), lists required questions it couldn't answer, and leaves submitting to you.
**Mark applied** updates the dashboard.

**Apply queue** (off until you turn it on in the options). From the popup, **Open and fill ready jobs**
opens each job with a tailored resume, ATS and match at or above your minimums, and an apply link, one
at a time in a background tab. Each is filled from your profile and saved answers, with that job's
tailored PDF attached. The queue steps through Next / Continue pages and stops at the Submit button,
outlined in green. **It never submits**: you open each tab from the popup, check it, press Submit, then
**Mark applied**. It stops early and says why ("Needs: …") at anything it cannot answer honestly:
free-text questions, consent boxes, sign-ups and passwords, and skill-specific questions like "years of
experience with Kafka", which it never answers with your total experience. Add such answers under
recurring questions (`experience with kafka => 0`) and they are used. Settings: minimum ATS (80) and match
(70), applications opened per day (10), and the pause between jobs (20 s). **LinkedIn Easy Apply** jobs
are included only if you tick it. LinkedIn's User Agreement forbids automated use of the site, and it can
restrict accounts it thinks are automated.

---

## Using it day to day

- **Jobs**: everything found, best match first, with each job's ATS score and next step (Tailor now,
  Resume, Apply). The title block shows the last and next scan and how many free resumes are left today.
- **Job page**: the **ATS panel** (score, what earned it, what your profile could still add, the skills
  you lack, and each revision round), the resume's checks and PDF, the job description, and your notes.
- **Tailor now**: on any job, in the dashboard or the extension. A GitHub Action tailors and scores the
  resume in about 3 minutes; the page updates when it lands.
- **Add a job**: paste a job the scans missed (referral, careers page), then tailor it straight away.
- **Skills**: your skills with how many jobs ask for each, and the **gaps**: skills jobs ask for that
  your profile lacks, ranked by demand, with example jobs. Mark each *To learn*, *Learning*, *I know
  this* or *Ignore*. "I know this" lets resumes name the skill in the Skills section, never as invented
  experience.
- **Board**: drag cards through New → Shortlisted → Queued → Resume ready, then Applied → Interviewing →
  Offer / Rejected.
- **Consumption**: tokens, money used, current balances, top-ups, and the health of each job source.

Tune `config/search.yaml` (queries, cities, title rules, `max_required_years`, `tailor_per_run`,
`min_score`, `ats.target`, `ats.minimum`, `ats.max_rounds`) and `config/companies.yaml` (find a company's
board with `python -m jobbot probe-company <slug>`).

## The ATS score

Computed in code (`jobbot/ats/score.py`), not by an LLM, from the text extracted from the compiled PDF,
which is what an ATS reads:

| Part | Points | Earned by |
|---|---|---|
| Required skills | 45 | Share of the job's required skills found on the resume (synonyms such as Postgres / PostgreSQL count) |
| Preferred skills | 15 | Share of the preferred skills found |
| Job title | 10 | Headline overlap with the job title (only headlines from `allowed_titles`) |
| Experience | 10 | Your years against the job's minimum |
| Education | 5 | Degree present when the job asks for one |
| Skills used in bullets | 5 | Required skills that appear in experience bullets, not only in the skills list |
| Format | 10 | One page, standard headings, contact details extractable, layout checks passed |

Below the target, up to two revision rounds add the missing skills **your profile already has**. The
best-scoring version is kept, and a version that claims a skill your profile lacks never wins. The
**best honest score** shows how high the score can go without inventing anything. When it is below 80,
the job page names the skills holding it back, and they appear on the Skills page.

## How the tailoring follows the framework

| Framework | Where |
|---|---|
| Phase 1 diagnostics | LLM JSON `diagnostics` → stored per resume, shown on the job page |
| Phase 2 rewrite (XYZ, impact order, anti-mirroring, ruthless edits) | LLM rewrites bullets by profile entry `id`; code orders by `impact_rank`, drops skills not in your vocabulary, and flags passive openers |
| Phase 3 dual-persona check | LLM `verification` notes + code checks: no em dashes, no pipes in the header, no Markdown, single-column layout |
| Rule 1 line fill | Bullets checked at 100–113 / 205–226 characters, then **measured in the PDF**: any bullet or summary whose last line is under 70% full is sent back for one fix-up |
| Rule 2 one full page | The template's vertical spacing is searched (margins, `\itemsep`, section spacing) for the fullest single page; under-filled pages ask the LLM to expand from real profile facts; only after spacing is exhausted is the weakest bullet cut |
| Rule 3 ATS extraction | Hard-coded in the template preamble, plus Latin Modern fonts with Unicode maps so text and bullets extract cleanly |
| Rule 4 no Markdown | Stripped in code and verified in the `.tex` |

Resumes that still break a rule after one fix-up are saved and marked **needs review** rather than
dropped. 10pt Latin Modern with 0.45in side margins was measured to fit 114–117 characters per bullet
line, which is why the framework's 113-character target holds.

## Run it on your laptop

Linux or WSL: install TeX Live as below. Windows without WSL: install Python 3.11 and
[MiKTeX](https://miktex.org) (allow it to install missing packages on the fly), and use
`.venv\Scripts\activate`. Copy `.env.example` to `.env` and fill in the keys you have: the bot loads it
automatically and it is git-ignored.

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev,claude]"
sudo apt-get install texlive-latex-base texlive-latex-recommended texlive-fonts-recommended lmodern

pytest -q && ruff check .                      # tests need no network or keys
python -m jobbot run --store local --llm fake --fixture tests/fixtures/sample_jobs.json   # full offline run → out/
python -m jobbot scan --sources linkedin,indeed,naukri,foundit                           # live fetch, no LLM
python -m jobbot tailor path/to/jd.txt --title "Backend Engineer" --company Acme         # one resume + ATS breakdown → out/manual/
python -m jobbot tailor-queued --store supabase --job-id <id>                            # what the Tailor now workflow runs

cd dashboard && npm install && VITE_DEMO=1 npm run dev
cd extension-tests && npm install && npm test && npm run test:browser
```

## Design

The dashboard and the extension were designed with [impeccable](https://github.com/pbakaus/impeccable),
installed in `.claude/skills/impeccable/` for Claude Code. `PRODUCT.md` records who the product is for,
`DESIGN.md` the visual system, and `.impeccable/surfaces/` the direction for each surface. The direction is
an engineering drawing sheet: graphite on a cool white sheet by day, a blueprint at night, one ballpoint-blue
(or sodium-yellow) accent for actions, and the ATS score drawn as a dimension line. CI runs impeccable's
detector on every dashboard page (desktop and phone) and on the extension; a finding fails the build.

## Known limits

- The five unofficial job sites can change or block at any time; the weekly **Source smoke test**
  workflow and the Consumption page show when one does. The Foundit parser was written against its
  known field names but not verified against a live response from this environment.
- The Wellfound actor's input format belongs to its author: check it once in Apify.
- Gemini free-tier limits change without notice; if resumes stop appearing, lower the caps in
  `config/pricing.yaml` or add a paid provider.
- Autofill and the apply queue were tested against local copies of Greenhouse-, Workday-style and
  multi-step forms and a stand-in for LinkedIn's Easy Apply dialog. The live sites (LinkedIn, Lever, Ashby,
  Workday…) change their markup and have not been tested from here; when a page is not recognised the
  queue stops with "needs you" and leaves the tab open. Free-text questions ("Why us?") are left to you
  unless you add a custom answer.
- The apply queue does not submit applications. Sending them automatically was not built: it stays a
  step you take on each tab.
