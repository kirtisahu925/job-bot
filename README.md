# SDE Job Bot

Scans job sites twice a day (10:00 and 22:00 IST), scores every new job against your profile, writes a
one-page tailored LaTeX/PDF resume for the best matches using the **LLM Resume Generation & Tailoring
Framework** (`prompts/framework.md`), and puts it all on a dashboard where you track what you applied to.
A Chrome extension fills in application forms and attaches the tailored PDF. **Nothing ever applies or
submits on your behalf.**

```
GitHub Actions (10:00 & 22:00 IST) ──► python -m jobbot run
  fetch    LinkedIn · Indeed · Naukri (python-jobspy) · Foundit · Wellfound (Apify)
           Adzuna · JSearch · Remotive · Jooble · Greenhouse/Lever/Ashby company boards
  filter   dedupe across sites → title / location / experience rules → skill-overlap ranking
  score    Gemini Flash-Lite, 8 jobs per request
  tailor   Gemini Flash: 4-phase framework → JSON → LaTeX template → pdflatex → one full page
  record   tokens, cost, quotas and balances for every provider
      ▼
Supabase (Postgres + private PDF storage + login)
      ▲                                    ▲
React dashboard                       Chrome extension
Jobs · Board · Consumption · Runs     Save job · Autofill · Attach resume · Mark applied
```

| Folder | What it is |
|---|---|
| `jobbot/` | The Python bot (sources, pipeline, LLM ledger, tailoring engine, stores, CLI) |
| `config/` | `search.yaml` (roles, cities, filters, per-source switches), `companies.yaml`, `pricing.yaml` |
| `prompts/` | Your framework verbatim, plus the scoring and output-contract prompts |
| `templates/resume.tex.j2` | Single-column ATS-safe LaTeX template with the Rule 3 preamble |
| `profile/` | `master_profile.example.yaml`: the structure of your master resume |
| `supabase/migrations/` | Database, security rules, storage bucket, usage and balance views |
| `dashboard/` | React + Vite site (host on Cloudflare Pages) |
| `extension/` | Chrome extension (Manifest V3, no build step) |
| `extension-tests/` | Unit and browser tests for the extension |

---

## APIs used and what they cost

### Job sources

LinkedIn, Indeed, Naukri, Foundit and Wellfound have **no public job-search API**. The bot reads their
public listings **without logging in** (so your accounts are never at risk), in small volumes, twice a
day. This is unofficial and against those sites' terms; it can break when a site changes, and LinkedIn
and Naukri in particular may block GitHub's datacenter IPs. Each source fails on its own without
stopping the run, its health is shown on the dashboard, and two fallbacks cover the gaps: JSearch (Google
for Jobs, which carries LinkedIn/Indeed/Naukri listings) and the extension's **Save job** button.

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

Per run: about **70k input and 20–30k output tokens** (scoring ~34k in / 5k out, 4 tailored resumes
~24k in / 10–22k out including thinking, fix-up calls ~12k in / 4k out). That is roughly 4.2M input and
1.5M output tokens a month. **On the Gemini free tier this costs $0.**

If you switch to Claude later (`llm.provider: anthropic` in `config/pricing.yaml`), the same volume costs
about **$55–60/month on Opus 5, $20–25 on Sonnet 5, or $10–12 on Haiku 4.5** at Anthropic list prices.
The Consumption page shows what your real usage would cost on the model named in `shadow_model`, so you
can decide with your own numbers.

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

### 1. Get the free keys

- **Gemini**: https://aistudio.google.com → Get API key.
- **Adzuna**: https://developer.adzuna.com → register → App ID + App Key.
- **JSearch**: https://rapidapi.com → subscribe to *JSearch* on the free *Basic* plan → copy your RapidAPI key.
- **Apify** (Wellfound): https://apify.com → free account → Settings → API token. Open the Wellfound
  actor named in `config/search.yaml` (`sources.wellfound.actor_id`), check its **Input** tab, and make
  `sources.wellfound.input` match it (`{query}` is replaced with each search). Or set `enabled: false`.
- Optional: **Jooble** key (https://jooble.org/api/about), then set `sources.jooble.enabled: true`.

### 2. Create the Supabase project

1. https://supabase.com → New project.
2. SQL Editor → paste all of `supabase/migrations/0001_init.sql` → Run.
3. In the SQL Editor, allow only your email to read the data:
   `insert into public.app_owner (email) values ('you@example.com');`
4. Authentication → Users → **Add user** with that email and a password (this is your dashboard and
   extension login). Then Authentication → Sign In / Providers → turn **off** "Allow new users to sign up".
5. Project Settings → API: copy the **Project URL**, the **anon** key (browser-safe) and the
   **service_role** key (secret: GitHub only).

### 3. Write your master profile

Copy `profile/master_profile.example.yaml` to `profile/master_profile.yaml` (git-ignored), replace every
value with your real history, and delete the `example: true` line. Everything the tailored resumes say
comes from here: the LLM may reword and reorder, but facts, dates and employers are copied from this file,
and skills it doesn't list are removed from the output. Bullets read best at 100–113 or 205–226 characters.

### 4. Add GitHub secrets

Repository → Settings → Secrets and variables → Actions → New repository secret:

`MASTER_PROFILE_YAML` (paste the whole file), `GEMINI_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`,
`RAPIDAPI_KEY`, `APIFY_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and optionally
`JOOBLE_API_KEY`, `ANTHROPIC_API_KEY`.

### 5. Turn on the schedule

GitHub only runs scheduled workflows from the **default branch**, so merge this branch into `main`.
Then Actions → **Job scan** → Run workflow to test it right away. Each run's summary (sources, tokens,
balances) appears on the run page. Scheduled runs can start 5–20 minutes late when GitHub is busy.

### 6. Deploy the dashboard

Cloudflare Pages → Create → Connect to Git → this repo. Root directory `dashboard`, build command
`npm run build`, output `dist`. Environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
Sign in with the user from step 2.4. (Try it first without Supabase: `cd dashboard && npm install &&
VITE_DEMO=1 npm run dev` shows sample data.)

### 7. Install the Chrome extension

`chrome://extensions` → Developer mode → **Load unpacked** → pick the `extension/` folder. Open its
options: paste the Supabase URL and anon key, sign in, fill your application profile (CTC, notice period,
links…), add answers to recurring questions (`keywords => answer`), and upload a default resume.

On a job page on LinkedIn/Indeed/Naukri/Foundit/Wellfound a **Save job** button appears: it saves the job
and queues a tailored resume for the next run. On an application form, click the extension → **Autofill
this page**: it fills recognised fields (outlined in green), attaches the tailored PDF for that job (or
your default resume), lists required questions it couldn't answer, and leaves submitting to you.
**Mark applied** updates the dashboard.

---

## Using it day to day

- **Jobs**: everything found, best score first; filter by date, status, track, source and score.
  "Tailor" queues a resume for any job the bot didn't pick automatically.
- **Board**: drag cards New → Shortlisted → Applied → Interviewing → Offer / Rejected.
- **Job detail**: Phase 1 diagnostics (match score, missing ATS keywords, red flags, strong/weak
  sections), the Phase 3 dual-persona notes, open lint issues, the PDF and LaTeX source, and your notes.
- **Consumption**: tokens, money used, current balances, top-ups, and the health of each job source.

Tune `config/search.yaml` (queries, cities, title rules, `max_required_years`, `tailor_per_run`,
`min_score`) and `config/companies.yaml` (find a company's board with
`python -m jobbot probe-company <slug>`).

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

## Local development

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev,claude]"
sudo apt-get install texlive-latex-base texlive-latex-recommended texlive-fonts-recommended lmodern

pytest -q && ruff check .                      # tests need no network or keys
python -m jobbot run --store local --llm fake --fixture tests/fixtures/sample_jobs.json   # full offline run → out/
python -m jobbot scan --sources linkedin,indeed,naukri,foundit                           # live fetch, no LLM
python -m jobbot tailor path/to/jd.txt --title "Backend Engineer" --company Acme         # one resume → out/manual/

cd dashboard && npm install && VITE_DEMO=1 npm run dev
cd extension-tests && npm install && npm test && npm run test:browser
```

## Known limits

- The five unofficial job sites can change or block at any time; the weekly **Source smoke test**
  workflow and the Consumption page show when one does. The Foundit parser was written against its
  known field names but not verified against a live response from this environment.
- The Wellfound actor's input format belongs to its author: check it once in Apify.
- Gemini free-tier limits change without notice; if resumes stop appearing, lower the caps in
  `config/pricing.yaml` or add a paid provider.
- Autofill was tested against local copies of Greenhouse- and Workday-style forms. Lever, Ashby, LinkedIn
  Easy Apply and other sites use the same generic field matching but have not been tested on the live
  sites. Free-text questions ("Why us?") are left to you unless you add a custom answer.
