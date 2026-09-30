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

Per scheduled run: scoring about 34k input / 5k output tokens, plus one tailored resume. A resume is
**three LLM calls** (build, hiring manager review, VP of hiring review; see "How each resume is written"),
about 20k input and 6k output tokens in all, measured on real runs, plus a fourth fix-up call only when
the result breaks a hard rule. Every Tailor now press costs the same as one resume. **On the Gemini free
tier this costs $0**, but the free tier allows only about 20 Flash calls a day, and Flash often answers
"503: high demand": on the first runs every resume fell back to Flash-Lite. The bot now skips a model that
stayed overloaded for the rest of that run instead of retrying it in every round.

If you switch to Claude (dashboard **Settings → AI for resumes**, or `llm.provider: anthropic` in
`config/pricing.yaml`), the Consumption page already shows what your real usage would cost on the model
named in `shadow_model` ("Would cost on a paid model"), so you can decide with your own numbers.

**Projected cost per resume by provider** (three rounds; ~20k input and ~6k output tokens, plus ~6k
thinking tokens on reasoning models; prices per million tokens as listed in September 2026, at ₹88/$;
Claude from Anthropic's price list, the others from public price trackers because their pricing pages
were not reachable from the build environment; check before you commit money):

| Provider and model | $ in / out | Per resume | 150 resumes a month | Wired in | Resume quality |
|---|---|---|---|---|---|
| Gemini Flash-Lite (free / paid) | 0 / 0, or 0.10–0.25 / 0.40–1.50 | ₹0–1.2 | ₹0–180 | yes | Follows the schema; weakest reviews |
| Gemini Flash, paid tier | 0.30–0.75 / 2.50–3.75 | ₹3–5 | ₹480–790 | yes (enable billing) | Good, and no daily cap or free-tier 503s |
| Gemini Pro (3.1) | 2 / 12 | ₹16 | ₹2,400 | yes (model name) | Frontier |
| Claude Haiku 4.5 | 1 / 5 | ₹4.4 | ₹660 | yes | Good, fast |
| Claude Sonnet 5.5 | 2 / 10 | ₹14 | ₹2,100 | yes | Frontier writing and critique |
| Claude Opus 5.5 | 4 / 20 | ₹28 | ₹4,200 | yes (the Claude default) | Frontier, most careful |
| OpenAI GPT-5 mini | 0.25 / 2 | ₹2.6 | ₹390 | no | Good |
| OpenAI GPT-5.4 / 5.5 | 2.50 / 15, 5 / 30 | ₹20 / ₹40 | ₹3,000 / ₹6,000 | no | Frontier |
| DeepSeek V3.2 | 0.28 / 0.42 | ₹1 | ₹145 | no | Good English; JSON mode without schema enforcement; data processed in China |
| Grok 4 Fast / Grok 4.6 | 0.20 / 0.50, 2 / 6 | ₹0.9 / ₹10 | ₹130 / ₹1,450 | no | Budget / frontier |
| Groq (gpt-oss-120b / Kimi K2) | 0.15 / 0.60, 1 / 3 | ₹0.9 / ₹3.3 | ₹130 / ₹500 | no | Very fast; open models, reviews shallower |

Scoring jobs and cover letters stay on free Flash-Lite whichever you pick (well under ₹100 a month even
on a paid tier). The providers marked "no" all speak the OpenAI API, so one small client class would
cover them.

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

If Tailor now says **"GitHub rejected the GH_DISPATCH_TOKEN secret (401 Bad credentials)"**, the token has
expired (fine-grained tokens have an end date you pick when creating them), was revoked, or was copied
incompletely. Generate a new one as in step 1 and save it over the old secret in step 2. Spaces, newlines
and quotes around the pasted token are ignored.

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

- **Jobs**: everything found, grouped by status and best match first, with each job's ATS score and next
  step (Tailor now, Resume, Apply). The header shows the last scan, what is new since your last visit, and
  how many free resumes are left today. Keys: `j`/`k` move, `Enter` opens, `t` tailors, `a` applies, `/`
  searches, and `⌘K` / `Ctrl+K` opens the command menu anywhere. A job the evaluation marks **Do not apply**
  or **Check posting** says so on its company line.
- **Job page**: the **ATS panel** (score, what earned it, what your profile could still add, the skills
  you lack), **How this resume was built** (the build round's reading of the job, the keywords it used
  and the gaps it left out, then each reviewer's findings and fixes, with the ATS score after every
  round), the resume's checks and PDF, the job description, and your notes.
- **Tailor now**: on any job, in the dashboard or the extension. A GitHub Action tailors and scores the
  resume in about 3 minutes; the page updates when it lands.
- **Add a job**: paste a job the scans missed (referral, careers page), then tailor it straight away.
- **Skills**: your skills with how many jobs ask for each, and the **gaps**: skills jobs ask for that
  your profile lacks, ranked by demand, with example jobs. Mark each *To learn*, *Learning*, *I know
  this* or *Ignore*. "I know this" lets resumes name the skill in the Skills section, never as invented
  experience.
- **Board**: drag cards through New → Shortlisted → Queued → Resume ready, then Applied → Interviewing →
  Offer / Rejected.
- **No longer accepting**: a status for postings that stopped taking applications (LinkedIn shows "No
  longer accepting applications"). Set it from a job's status menu; the extension's apply queue sets it by
  itself when a page says so, and the popup offers **Mark as closed** on such a page. These jobs sit under
  the **Closed** tab.
- **Applications**: every job you applied to, by stage (Applied, Interviewing, Offer, Rejected), with
  the day you applied, the resume's ATS score, and the next step: follow up every 2-3 days until they
  answer (LinkedIn, then e-mail, then WhatsApp, then a call), say yes to a face-to-face round, and weigh
  an offer against the company's salary bracket. The summary line shows how many companies answered.
- **Companies**: where you want to work and what they pay, in LPA. It starts with the 65 companies from
  hey.aanchal's Instagram post ("Everyone is chasing FAANG. Meanwhile, these companies are quietly paying
  30+ LPA in India"), each with its bracket on one shared scale, how many of its jobs are in your tracker,
  and your contacts there. Star your targets, edit a bracket, add a company, and paste its Greenhouse,
  Lever or Ashby board link: every scan then reads its openings directly (Remote's board,
  `greenhouse/remotecom`, is already in).
- **Activity**: one timeline of scans, resumes (with their round-by-round ATS), application changes and,
  with the Contacts add-on, messages to contacts, grouped by day.
- **Preferences**: what you are aiming for (level such as SDE-2, roles, what to bring forward or play down,
  notes for the writer; the resume rounds read these) and what the scans look for (kinds of role, cities,
  remote, maximum years asked, extra title words to skip, a minimum salary).
- **Settings**: which review rounds run, the ATS target and minimum, fix-up calls, the AI for resumes
  (free Gemini, Claude Sonnet 5.5 or Claude Opus 5.5, with the cost of each), resumes per scheduled scan,
  cover letters, and your account.
- **Consumption**: tokens, money used, current balances, top-ups, and the health of each job source.

Preferences and Settings live in Supabase (`user_settings`, migration 0008) and are laid over the repo's
config at the start of every scan and Tailor now; anything left blank keeps `config/search.yaml`
(queries, cities, title rules, `max_required_years`, `tailor_per_run`, `min_score`, `ats.target`,
`ats.minimum`, `resume.reviewers`, `resume.fix_rounds`). Company boards come from `config/companies.yaml`
plus the Companies page (find a board with `python -m jobbot probe-company <slug>`).

## Contacts (an add-on for your account)

HR, recruiter and hiring-manager contacts, grouped by company, with every follow-up recorded. The page appears
only for accounts granted the `contacts` add-on (`feature_grants` in `supabase/migrations/0006_contacts.sql`);
the owner account has it. To give it to another account later, for example after a separate payment, run in the
Supabase SQL editor: `insert into feature_grants (user_id, feature) select id, 'contacts' from auth.users where
email = 'their@email';`. Each account sees only its own contacts. The contact data lives in your Supabase
project only, never in this repository.

- **Due**: who to contact today and in the next 3 days, target companies first. The order follows one rule:
  start on **LinkedIn** (an invite, or an InMail with Premium); if they do not accept or reply within 2-3 days,
  send a **cold e-mail**; then a **WhatsApp** message; then **call**. Channels a contact has no details for
  are skipped. Once they reply, follow up every 2-3 days where they answered.
- **A contact's page**: the next step, a ready-to-send message for each channel (written from your details
  in Contacts, Your details), buttons that open LinkedIn, your mail app, WhatsApp or the dialler with the
  text in place, and one click to record what happened, which schedules the next follow-up. Nothing is sent
  for you: you press Send in each app. The call notes include the rule for interviews: when HR asks your
  availability, say yes to a face-to-face round and let them schedule it around you.
- **Companies**: contacts, how many you reached, and your open jobs per company. Star a company as a
  **target** (Qualys is starred) to get LinkedIn people searches for its Directors, VPs and Managers.
- **Import**: paste a WhatsApp chat export, vCards, name/number lists or e-mail lists. Numbers are normalised,
  spellings like "Phone Pay" become PhonePe, duplicates merge, and contacts you already have are skipped.
  WhatsApp exports only the count for multi-contact cards ("[82 contacts]"); forward those cards as .vcf files,
  or open each and copy its details, to import them.
- A job's page lists your **People at** that company.

## Evaluation: do not apply, and is the posting real

The scoring call also judges each job the way [career-ops](https://github.com/career-ops-hq/career-ops)
(MIT) does, kept separate from fit:

- **Verdict**: *worth applying*, *could go either way* or **do not apply**. An explicit hard stop (for
  example "no visa sponsorship" or an on-site office you cannot move to) always means do not apply. Those
  jobs are never tailored automatically and the extension's apply queue skips them.
- **Posting**: *looks like a real, open role*, *check it is still open*, or **suspicious** (fees, no named
  company, the same ad reposted under many titles). A posting older than 30 days is flagged in code.

The reasons are listed on the job page under "Why not to apply" and "What the posting shows".

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

Each review round is told which skills **your profile already has** but the draft does not say, and is
asked to reach the target with them. A version that claims a skill your profile lacks never wins. The
**best honest score** shows how high the score can go without inventing anything. When it is below 80,
the job page names the skills holding it back, and they appear on the Skills page.

## How each resume is written

Every resume goes through the same rounds, with the built-in template or inside your own LaTeX file
(`jobbot/tailor/rounds.py`, prompts in `prompts/review*.md`):

1. **Build.** One call reads the job description, your profile and skills, and your Preferences, and
   writes its reasoning first: what the team needs, the must-haves and nice-to-haves, the level, which
   of your work proves each must-have, the keywords it will use (only ones your profile supports), the
   gaps it will leave out, and its strategy. Then it writes the resume from that.
2. **Hiring manager review.** The manager for this exact role reads the draft the way they screen 200
   applicants: is the top third convincing, does each bullet show evidence (what, with what, at what
   scale, with what result), is there depth in the job's core stack, is anything irrelevant, inflated or
   keyword-stuffed. It lists 3-8 findings and rebuilds the resume to fix them.
3. **VP of hiring review.** A senior hiring manager / VP of Engineering reads for level (SDE-2 signals:
   ownership, design decisions, production responsibility), trajectory, business impact, what makes you
   memorable, and one coherent story, keeps the manager's fixes, and rebuilds it again.
4. **ATS score.** Code compiles each round's resume, fits it to one page, runs the layout and honesty
   checks, and scores it (the table above). The latest round that clears the ATS minimum and claims
   nothing your profile lacks is kept. If the final round breaks a hard rule or scores under the
   minimum, one fix-up call runs.

Facts never change across rounds: every reviewer works from the same profile, and the honesty check
rejects any claim it cannot back. If a round cannot run (the day's quota is used up), the resume from the
rounds before it is saved and the skipped round is noted. Switch reviewers off on the Settings page to
save calls.

## Your own LaTeX resume (Overleaf)

By default resumes are built from `profile/master_profile.yaml` with the bot's own one-page template. To
tailor **inside your own resume** instead, with your layout, fonts and sections exactly as in Overleaf:

1. In Overleaf: **Menu → Download → Source**. Unzip it.
2. Copy the main file to `profile/resume.tex`. If it uses a class, style, font or image file of its own
   (`resume.cls`, `*.sty`, `*.ttf`...), copy those into `profile/` too.
3. Check it on your laptop: `python -m jobbot tailor jd.txt --llm fake` should print
   *Tailoring inside profile/resume.tex (N editable lines, 1 page(s))*. Then commit and push.

From then on every resume (scheduled and **Tailor now**) is your file with only these parts rewritten for
the job: the text of each bullet, the items of each skills line (reordered, plus skills your profile lists),
and a summary paragraph if you have one. Headings, roles, dates, links and spacing never change.

Each rewrite passes a **fact gate** (`jobbot/tailor/facts.py`) before it is used. A rewrite is dropped, and
your original line kept, when it uses a number or names a tool that the same role or project never mentions
(in your resume or in the matching entry of `master_profile.yaml`), drops a skill, adds a skill your profile
does not list, adds vague words ("significantly", "cutting-edge"), or grows so much the page would overflow.
The result must compile to the same number of pages as your original. The job page lists anything the gate
kept back.

Supported layouts: Jake's resume and its variants (`\resumeSubheading` + `\resumeItem`, including the
older two-argument `\resumeItem`) and plain `tabularx` + `itemize` resumes. A layout it cannot read, or a
file that does not compile, falls back to the built-in template and says so in the run summary. The slot
finder is a Python port of [career-ops](https://github.com/career-ops-hq/career-ops)' `latex-content.mjs`
(MIT).

## Cover letters

With each tailored resume the bot writes a short cover letter (three paragraphs, one Flash-Lite call) from
that resume's own text. Any sentence that cites a number or a tool your resume and profile never mention
is removed before it is saved. The job page shows it with a **Copy** button, and the extension fills it into
a "Cover letter" box on application forms (only the letter saved for that job, never a generic one). Turn it
off with `cover_letter.enabled: false` in `config/search.yaml`.

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
a Linear-style dark workspace: near-black violet-tinted surfaces, one violet accent for focus, selection
and the primary action, Inter with tabular figures, progress-circle status icons, a ⌘K command menu, and
a light theme (or follow-the-device) from the sidebar. CI runs impeccable's detector on every dashboard
page (desktop and phone) and on the extension; a finding fails the build.

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
