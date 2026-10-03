// Sample data so the dashboard can be previewed (and screenshotted in CI) without a Supabase project.
import type { Api } from "./api";
import type {
  ApiUsageDay,
  AtsDetail,
  Balance,
  CreditBalance,
  FitBreakdown,
  FitPart,
  Job,
  JobStatus,
  ProfileSnapshot,
  Run,
  SkillDemand,
  SkillStatus,
  RoundRecord,
  Tailoring,
  Topup,
  UsageDay,
} from "./types";

let seed = 7;
function rand(): number {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

// Scans run at 10:00 and 22:00 IST (04:30 and 16:30 UTC); demo times follow that and never lie in the future.
const now = Date.now();
const iso = (daysAgo: number, hour = 10) => {
  const d = new Date(now);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysAgo, hour === 22 ? 16 : 4, 30);
  return new Date(t > now ? t - 86400000 : t).toISOString();
};
const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);

const companies = ["Acme Fintech", "Orbit Labs", "Brightcart", "Quanta", "Nimbus Tech", "Pixel Works", "Tiny Startup",
  "Ledgerly", "Cargo Grid", "Mediwave", "Stackfold", "Paysure"];
const titles: [string, string][] = [
  ["Backend Engineer (SDE-2), Payments", "java"],
  ["Java Developer, Spring Boot", "java"],
  ["Software Engineer - Backend (Java)", "java"],
  ["Python Developer", "python"],
  ["Backend Engineer, Python/FastAPI", "python"],
  ["Full Stack Developer (Node.js + React)", "fullstack"],
  ["Node.js Backend Developer", "fullstack"],
  ["SDE II, Platform", "java"],
];
const cities = ["Bengaluru", "Gurugram", "Noida", "Hyderabad", "Pune", "Delhi", "Chennai"];
const sources = ["linkedin", "naukri", "indeed", "foundit", "wellfound", "greenhouse", "lever", "adzuna", "jsearch"];
const statuses: JobStatus[] = ["new", "new", "new", "new", "shortlisted", "shortlisted", "tailor_queued", "tailored",
  "tailored", "tailored", "applied", "applied", "interviewing", "rejected", "skipped", "expired"];

const JD = `About the role
We are hiring a backend engineer to build payment and order services.
- Design REST APIs and microservices in Java and Spring Boot
- Own PostgreSQL schemas, migrations and Redis caching
- Run services on Docker with CI in GitHub Actions
Requirements: 2-4 years of experience in backend development.`;

// A sample profile: what "your skills" look like on the Skills page (synthetic, not a real person).
const PROFILE: ProfileSnapshot = {
  headline: "Backend Software Engineer",
  years_experience: 2.4,
  skills: ["Java", "Spring Boot", "Hibernate", "JPA", "REST APIs", "Microservices", "PostgreSQL", "MySQL", "Docker",
    "Kubernetes", "Azure", "Azure Functions", "Python", "JavaScript", "Node.js", "React", "Git", "CI/CD", "Linux",
    "SQL", "JUnit", "AWS"],
  categories: {
    Languages: ["Java", "Python", "JavaScript", "SQL"],
    Backend: ["Spring Boot", "Hibernate", "JPA", "REST APIs", "Microservices", "Node.js"],
    Data: ["PostgreSQL", "MySQL"],
    Cloud: ["Azure", "Azure Functions", "AWS", "Docker", "Kubernetes"],
    Tools: ["Git", "CI/CD", "Linux", "JUnit", "React"],
  },
  updated_at: iso(0),
};
const HAVE = new Set(PROFILE.skills.map((x) => x.toLowerCase()));

const KEYWORDS: Record<string, { required: string[]; preferred: string[] }[]> = {
  java: [
    { required: ["Java", "Spring Boot", "Microservices", "REST APIs", "PostgreSQL", "Kafka"], preferred: ["Redis", "AWS", "Docker"] },
    { required: ["Java", "Spring Boot", "Hibernate", "MySQL", "REST APIs"], preferred: ["Kafka", "System Design"] },
    { required: ["Java", "Microservices", "Kubernetes", "Kafka", "System Design"], preferred: ["gRPC", "Redis", "Terraform"] },
  ],
  python: [
    { required: ["Python", "FastAPI", "PostgreSQL", "REST APIs", "Docker"], preferred: ["Celery", "Redis", "AWS"] },
    { required: ["Python", "Django", "SQL", "REST APIs"], preferred: ["Kafka", "Kubernetes"] },
  ],
  fullstack: [
    { required: ["Node.js", "React", "TypeScript", "MongoDB", "REST APIs"], preferred: ["GraphQL", "AWS", "Docker"] },
    { required: ["Node.js", "TypeScript", "PostgreSQL", "React"], preferred: ["Next.js", "Redis"] },
  ],
};

/** Mirrors jobbot/ats/score.py closely enough for previews. */
function demoAts(kw: { required: string[]; preferred: string[] }, minYears: number, seedN: number, needsReview: boolean): AtsDetail {
  const has = (x: string) => HAVE.has(x.toLowerCase());
  const fixable = kw.required.filter(has).slice(seedN % 3 === 0 ? -1 : kw.required.length);
  const matchedReq = kw.required.filter((x) => has(x) && !fixable.includes(x));
  const matchedPref = kw.preferred.filter(has);
  const gaps = [...kw.required, ...kw.preferred].filter((x) => !has(x));
  const fixPref: string[] = [];
  const pt = (w: number, r: number) => Math.round(w * Math.min(1, Math.max(0, r)) * 10) / 10;
  const expRatio = Math.min(1, 2.4 / minYears);
  const titleRatio = seedN % 2 ? 1 : 0.67;
  const breakdown = {
    required: { points: pt(45, matchedReq.length / kw.required.length), max: 45, note: `${matchedReq.length} of ${kw.required.length} required skills` },
    preferred: { points: pt(15, kw.preferred.length ? matchedPref.length / kw.preferred.length : 1), max: 15, note: `${matchedPref.length} of ${kw.preferred.length} preferred skills` },
    title: { points: pt(10, titleRatio), max: 10, note: "headline vs the job title" },
    experience: { points: pt(10, expRatio), max: 10, note: `2.4 yrs vs ${minYears}+ asked` },
    education: { points: 5, max: 5, note: "degree required" },
    placement: { points: pt(5, 0.8), max: 5, note: "1 required skill only in the skills list" },
    format: { points: needsReview ? 8.8 : 10, max: 10, note: needsReview ? "last line of a bullet too short" : "all checks pass" },
  };
  const reach = {
    required: pt(45, (matchedReq.length + fixable.length) / kw.required.length),
    preferred: pt(15, kw.preferred.length ? (matchedPref.length + fixPref.length) / kw.preferred.length : 1),
    title: 10,
    experience: breakdown.experience.points,
    education: 5,
    placement: 5,
    format: 10,
  };
  const score = Math.round(Object.values(breakdown).reduce((a, p) => a + p.points, 0));
  const best = Math.max(score, Math.round(Object.values(reach).reduce((a, p) => a + p, 0)));
  const r0 = Math.max(40, score - 9 - (seedN % 4));
  return {
    score, max_achievable: best, target: 90, breakdown, reach,
    matched_required: matchedReq, matched_preferred: matchedPref, missing_fixable: [...fixable, ...fixPref],
    missing_gaps: gaps, skills_only: matchedReq.slice(0, 1), best_title: "Software Development Engineer",
    rounds: seedN % 3 === 2 ? [r0, score] : [r0, score - 3, score],
  };
}

export const DEMO_ROUNDS: RoundRecord[] = [
  {
    name: "build",
    title: "Build",
    ats_score: 78,
    analysis: {
      role_focus: "Own payment APIs in Java and Spring Boot end to end.",
      must_haves: ["Java", "Spring Boot", "REST APIs", "PostgreSQL", "3+ years"],
      nice_to_haves: ["Kafka", "AWS"],
      seniority: "SDE-2; you have 2.4 years, close to the 3 asked for",
      candidate_fit: ["Java: current role, orders platform", "PostgreSQL: current role, onboarding portal"],
      keywords: ["Java", "Spring Boot", "REST APIs", "PostgreSQL", "AWS"],
      gaps: ["Kafka"],
      preferences_applied: ["target level SDE-2: led with ownership of the orders platform"],
      strategy: "Lead with the orders platform APIs, then the automation work that shows production ownership.",
    },
    review: null,
    problems: [],
    skipped: null,
    kept: false,
  },
  {
    name: "hiring_manager",
    title: "Hiring manager review",
    ats_score: 86,
    analysis: null,
    review: {
      first_impression: "Backend engineer with real Java APIs, but the scale is buried.",
      verdict: "maybe",
      findings: [
        { area: "current/orders bullet 1", issue: "Says what was built, not how many users it serves", fix: "Added the user count the profile states", severity: "high" },
        { area: "summary", issue: "Lists technologies instead of saying what they own", fix: "Rewrote around owning the orders and onboarding APIs", severity: "medium" },
        { area: "skills", issue: "PostgreSQL only in the skills list", fix: "Named it in the onboarding portal bullet", severity: "medium" },
      ],
      after: "Reads as someone who ships and runs backend services.",
    },
    problems: ["ATS: these required skills appear only in the skills list: PostgreSQL"],
    skipped: null,
    kept: false,
  },
  {
    name: "vp_hiring",
    title: "VP of hiring review",
    ats_score: 88,
    analysis: null,
    review: {
      first_impression: "Solid SDE-1 profile; the SDE-2 signals need to be louder.",
      verdict: "interview",
      findings: [
        { area: "current/automation", issue: "The design decision behind the move to serverless is missing", fix: "Stated the trade-off the profile describes", severity: "high" },
        { area: "previous/portal", issue: "Two bullets say the same thing", fix: "Merged them and used the space for the production support work", severity: "low" },
      ],
      after: "Tells one story: an engineer who owns services end to end.",
    },
    problems: [],
    skipped: null,
    kept: true,
  },
];

function demoTailoring(job: Job, i: number, created: string): Tailoring {
  const needsReview = i % 4 === 0;
  const ats = demoAts(job.jd_keywords ?? { required: [], preferred: [] }, job.min_years ?? 2, i, needsReview);
  return {
    id: `t-${i}-${created}`, job_id: job.id, created_at: created, provider: "gemini", model: "gemini-flash-latest",
    status: needsReview ? "needs_review" : "ok",
    diagnostics: { match_score: job.llm_score ?? 70, missing_keywords: ats.missing_gaps,
      red_flags: (job.llm_score ?? 70) < 75 ? ["Asks for 3+ years of Java in production"] : [],
      strong_sections: ["current role: Azure Functions and REST APIs map to the platform work"],
      weak_sections: ["previous role: front-end work is off-target"] },
    verification: { ats_parser: `${ats.matched_required.join(", ")} extracted cleanly${ats.missing_gaps.length ? `; ${ats.missing_gaps[0]} still absent` : ""}.`,
      hiring_manager: "Summary reads naturally; the order-service project leads the projects section." },
    lint_issues: needsReview ? [{ code: "stub", where: "project#2", message: "The second project bullet ends in a short last line (48% full)", llm_fixable: true }] : [],
    fixes: ats.missing_gaps.length ? [`skills: left out ${ats.missing_gaps[0]}, which your profile does not list`] : [],
    revisions: (ats.rounds?.length ?? 1) - 1, pages: 1, fill_ratio: 0.97, tex_path: "demo/resume.tex", pdf_path: "demo/resume.pdf",
    ats_score: ats.score, ats,
    // resumes written after the review rounds shipped: build, hiring manager, VP of hiring (the last one kept)
    rounds: i >= 7 && i <= 12 ? DEMO_ROUNDS.map((r, n) => ({ ...r, ats_score: Math.max(0, ats.score - [11, 3, 0][n]), kept: n === 2 })) : null,
    cover_letter:
      `Dear Hiring Team,\nI am applying for the ${job.title} role at ${job.company}. The team's work on payment and ` +
      "order services is close to what I build every day.\n\nAt my current company I built REST APIs on Azure Functions " +
      "that onboard franchise partners end to end, and I moved a nightly batch job to event-driven functions. Before " +
      "that I maintained Java services for a document platform used by insurance teams.\n\nI would welcome a " +
      "conversation about the role.\n\nRegards,\nDemo Candidate",
  };
}

const DOMAINS = [
  "Franchise onboarding, close to your Burger Singh work",
  "Fintech is new to you",
  "Insurance documents at Netlink: a related domain",
  "B2B SaaS, like your current work",
  "Consumer marketplace: a new domain",
];

function demoFit(i: number, minYears: number): FitBreakdown {
  const have = 2 + (i % 3); // never all five: the demo jobs all ask for Kafka
  const exp = minYears <= 2.4 ? 1 : minYears - 2.4 <= 1 ? 0.7 : 0.4;
  const parts: FitPart[] = [
    { key: "skills", label: "Required skills", weight: 3, value: have / 5, note: `${have} of 5; missing Kafka` },
    { key: "experience", label: "Experience", weight: 2, value: exp, note: `2.4 years vs ${minYears}+ asked` },
    { key: "domain", label: "Domain", weight: 2, value: (4 + (i % 6)) / 10, note: DOMAINS[i % DOMAINS.length] },
    { key: "seniority", label: "Seniority", weight: 2, value: 0.8, note: "SDE-2 scope fits 2.4 years" },
    { key: "projects", label: "Similar work", weight: 1, value: (5 + (i % 5)) / 10, note: "REST APIs and serverless jobs, as in this role" },
    { key: "education", label: "Education", weight: 1, value: 1, note: "no specific degree asked" },
  ];
  const score = Math.round((100 * parts.reduce((s, p) => s + p.weight * p.value, 0)) / 11);
  return { score, label: score >= 80 ? "Strong fit" : score >= 60 ? "Moderate fit" : "Stretch", parts };
}

const jobs: Job[] = Array.from({ length: 26 }, (_, i) => {
  const [title, track] = titles[i % titles.length];
  const status = statuses[i % statuses.length];
  const fit = demoFit(i, 2 + (i % 3));
  const score = fit.score;
  const company = companies[i % companies.length];
  const srcs = Array.from(new Set([pick(sources), pick(sources)]));
  // a scan stores its jobs a few minutes after it starts
  const created = new Date(Math.min(now, new Date(iso(Math.floor(i / 3), i % 2 ? 22 : 10)).getTime() + (4 + (i % 5)) * 60000)).toISOString();
  const tailored = ["tailored", "applied", "interviewing", "rejected"].includes(status);
  const pool = KEYWORDS[track];
  const job: Job = {
    id: `demo-${i + 1}`,
    title,
    company,
    location: i % 7 === 6 ? "Remote (India)" : `${cities[i % cities.length]}, India`,
    city: i % 7 === 6 ? null : cities[i % cities.length],
    remote: i % 7 === 6,
    apply_url: "https://example.com/apply",
    description: JD,
    posted_at: created,
    track,
    min_years: 2 + (i % 3),
    llm_score: score,
    score_reason: score > 80 ? "Strong Java and REST overlap; experience range fits" : "Stack overlap is partial",
    missing_keywords: score > 80 ? ["Kafka", "Redis"] : ["Kafka", "gRPC", "System Design"],
    status,
    captured_by: i === 5 ? "extension" : "bot",
    notes: status === "interviewing" ? "Round 1 on Friday, system design." : null,
    applied_at: ["applied", "interviewing", "rejected"].includes(status) ? iso(Math.floor(i / 3) - 1 < 0 ? 0 : Math.floor(i / 3) - 1) : null,
    created_at: created,
    updated_at: created,
    job_links: srcs.map((s, k) => ({ source: s, url: `https://example.com/${s}/${i}`, url_key: `${s}:${i}${k}` })),
    jd_keywords: pool[i % pool.length],
    ats_score: null,
    tailor_requested_at: null,
    verdict: i === 3 ? "skip" : score >= 70 ? "apply" : score >= 55 ? "maybe" : "skip",
    legitimacy: i === 2 ? "suspicious" : i === 10 ? "caution" : "high",
    legitimacy_signals:
      i === 2
        ? ["Asks for a registration fee before the interview", "No company website or named team"]
        : i === 10
          ? ["posted 34 days ago", "Same description reposted under three titles"]
          : ["Named team and a concrete stack", "Salary band stated"],
    hard_stops: i === 3 ? ['JD says "no relocation support; Dubai office only"'] : [],
    fit,
    tailorings: [],
  };
  if (tailored) {
    job.tailorings = [demoTailoring(job, i, created)];
    job.ats_score = job.tailorings[0].ats_score;
  }
  return job;
});

let skillRows: SkillStatus[] = [
  { skill: "Kafka", status: "learning", note: null, updated_at: iso(2) },
  { skill: "Terraform", status: "ignore", note: null, updated_at: iso(5) },
];

function demand(): SkillDemand[] {
  const m = new Map<string, SkillDemand & { scores: number[] }>();
  for (const j of jobs) {
    if (!j.jd_keywords || j.status === "archived") continue;
    for (const [kind, list] of [["required", j.jd_keywords.required], ["preferred", j.jd_keywords.preferred]] as const) {
      for (const skill of list) {
        const key = skill.toLowerCase();
        const e = m.get(key) ?? { skill_key: key, skill, required_by: 0, preferred_by: 0, jobs: 0, avg_job_score: null,
          tracks: [], example_job_ids: [], scores: [] };
        if (kind === "required") e.required_by += 1;
        else e.preferred_by += 1;
        if (!e.example_job_ids.includes(j.id)) {
          e.jobs += 1;
          e.example_job_ids.push(j.id);
          e.scores.push(j.llm_score ?? 0);
        }
        if (j.track && !e.tracks.includes(j.track)) e.tracks.push(j.track);
        m.set(key, e);
      }
    }
  }
  return [...m.values()].map(({ scores, ...e }) => ({
    ...e,
    avg_job_score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    example_job_ids: e.example_job_ids
      .map((id) => jobs.find((j) => j.id === id)!)
      .sort((a, b) => (b.llm_score ?? 0) - (a.llm_score ?? 0))
      .slice(0, 5)
      .map((j) => j.id),
  }));
}

function usage(): UsageDay[] {
  const rows: UsageDay[] = [];
  for (let d = 29; d >= 0; d--) {
    const runs = d === 0 ? 1 : 2;
    const tailors = Math.round(runs * (2 + rand() * 2));
    const revises = Math.round(tailors * 0.6);
    const scoreReq = runs * 4;
    rows.push({ day: day(d), provider: "gemini", model: "gemini-flash-lite-latest", purpose: "score", requests: scoreReq,
      failed: 0, input_tokens: scoreReq * 8600, output_tokens: scoreReq * 1150, thinking_tokens: 0, cached_tokens: 0,
      cost_usd: 0, shadow_cost_usd: scoreReq * 0.029 });
    rows.push({ day: day(d), provider: "gemini", model: "gemini-flash-latest", purpose: "tailor", requests: tailors,
      failed: d % 9 === 0 ? 1 : 0, input_tokens: tailors * 6100, output_tokens: tailors * 2600,
      thinking_tokens: tailors * 1900, cached_tokens: 0, cost_usd: 0, shadow_cost_usd: tailors * 0.057 });
    rows.push({ day: day(d), provider: "gemini", model: "gemini-flash-latest", purpose: "revise", requests: revises,
      failed: 0, input_tokens: revises * 9200, output_tokens: revises * 2700, thinking_tokens: revises * 900,
      cached_tokens: 0, cost_usd: 0, shadow_cost_usd: revises * 0.054 });
  }
  return rows;
}

function apiUsage(): ApiUsageDay[] {
  const rows: ApiUsageDay[] = [];
  for (let d = 29; d >= 0; d--) {
    for (const s of ["linkedin", "indeed", "naukri", "foundit", "wellfound", "adzuna", "jsearch", "remotive"]) {
      rows.push({ day: day(d), source: s, calls: s === "wellfound" ? 4 : 6, results: Math.round(20 + rand() * 60),
        cost_usd: s === "wellfound" ? 0.04 : 0, failures: s === "linkedin" && d % 5 === 0 ? 1 : 0 });
    }
  }
  return rows;
}

const balances: Balance[] = [
  { provider: "gemini:gemini-flash-latest", kind: "quota", unit: "requests", used: 9, limit_value: 18, remaining: 9,
    period: "day", method: "ledger", note: "free tier; resets at midnight Pacific", checked_at: iso(0) },
  { provider: "gemini:gemini-flash-lite-latest", kind: "quota", unit: "requests", used: 8, limit_value: 450,
    remaining: 442, period: "day", method: "ledger", note: "free tier; resets at midnight Pacific", checked_at: iso(0) },
  { provider: "apify", kind: "money", unit: "USD", used: 1.24, limit_value: 5, remaining: 3.76, period: "month",
    method: "live_api", note: "from Apify /users/me/limits", checked_at: iso(0) },
  { provider: "jsearch", kind: "quota", unit: "requests", used: 162, limit_value: 190, remaining: 28, period: "month",
    method: "live_api", note: "RapidAPI Basic plan", checked_at: iso(0) },
  { provider: "adzuna", kind: "quota", unit: "calls", used: 12, limit_value: 200, remaining: 188, period: "day",
    method: "ledger", note: null, checked_at: iso(0) },
];

let topupRows: Topup[] = [
  { id: "tp-1", provider: "anthropic", amount_usd: 10, purchased_at: iso(12), note: "first top-up (demo)" },
];

const runsData: Run[] = Array.from({ length: 14 }, (_, i): Run => {
  const blocked = i % 5 === 0;
  const srcs = ["linkedin", "indeed", "naukri", "foundit", "wellfound", "adzuna", "jsearch", "remotive"].map((s) => ({
    source: s,
    status: s === "linkedin" && blocked ? "blocked" : s === "foundit" && i === 3 ? "broken" : s === "naukri" && i === 7 ? "empty" : "ok",
    calls: s === "wellfound" ? 2 : 3,
    results: Math.round(10 + rand() * 50),
    cost_usd: s === "wellfound" ? 0.02 : 0,
    error: s === "linkedin" && blocked ? "LinkedIn responded with 429" : null,
  }));
  const fetched = srcs.reduce((a, s) => a + s.results, 0);
  return {
    id: `run-${i}`,
    trigger: i === 2 ? "manual" : "schedule",
    status: "ok",
    started_at: iso(Math.floor(i / 2), i % 2 ? 10 : 22),
    finished_at: iso(Math.floor(i / 2), i % 2 ? 10 : 22),
    fetched,
    new_jobs: Math.round(fetched * 0.12),
    scored: 24,
    tailored: 4,
    summary: { sources: srcs, errors: [], kept: Math.round(fetched * 0.3),
      llm: { requests: 12, input_tokens: 70100, output_tokens: 19800, thinking_tokens: 7300, cost_usd: 0 } },
  };
}).sort((a, b) => b.started_at.localeCompare(a.started_at));

const wait = () => new Promise((r) => setTimeout(r, 60));

export const demoApi: Api = {
  demo: true,
  async signIn() {},
  async signOut() {},
  async currentEmail() {
    return "demo@example.com";
  },
  async listJobs() {
    await wait();
    return jobs.map((j) => ({ ...j }));
  },
  async counts() {
    return {
      ready: jobs.filter((j) => j.status === "tailored").length,
      triage: jobs.filter((j) => ["new", "shortlisted", "tailor_queued"].includes(j.status)).length,
    };
  },
  async getJob(id) {
    await wait();
    const j = jobs.find((x) => x.id === id);
    return j ? { ...j } : null;
  },
  async updateJob(id, patch) {
    const j = jobs.find((x) => x.id === id);
    if (j) Object.assign(j, patch, patch.status === "applied" && !j.applied_at ? { applied_at: new Date().toISOString() } : {});
  },
  async signedUrl() {
    return "data:text/plain,Demo mode: connect Supabase to download real resumes.";
  },
  async usageDaily(since) {
    return usage().filter((r) => r.day >= since);
  },
  async apiUsageDaily(since) {
    return apiUsage().filter((r) => r.day >= since);
  },
  async latestBalances() {
    return balances;
  },
  async creditBalances(): Promise<CreditBalance[]> {
    const credit = topupRows.filter((t) => t.provider === "anthropic").reduce((a, t) => a + t.amount_usd, 0);
    return credit ? [{ provider: "anthropic", credit_usd: credit, spent_usd: 2.35, balance_usd: credit - 2.35, since: iso(12) }] : [];
  },
  async topups() {
    return topupRows;
  },
  async addTopup(t) {
    topupRows = [{ ...t, id: `tp-${Date.now()}` }, ...topupRows];
  },
  async deleteTopup(id) {
    topupRows = topupRows.filter((t) => t.id !== id);
  },
  async runs(limit) {
    return runsData.slice(0, limit);
  },
  async tailorNow(jobId) {
    const j = jobs.find((x) => x.id === jobId);
    if (!j) throw new Error("Job not found");
    if (j.tailor_requested_at && Date.now() - new Date(j.tailor_requested_at).getTime() < 120000)
      return "Already tailoring this job; it will be ready in a few minutes.";
    j.status = "tailor_queued";
    j.tailor_requested_at = new Date().toISOString();
    const i = Number(jobId.replace(/\D/g, "")) || 1;
    // the demo "workflow" finishes in about 8 seconds instead of 3 minutes
    setTimeout(() => {
      const t = demoTailoring(j, i + 1, new Date().toISOString());
      j.tailorings = [t, ...j.tailorings];
      j.ats_score = t.ats_score;
      j.status = "tailored";
    }, 8000);
    return `Tailoring "${j.title}". Demo mode: the resume appears in a few seconds.`;
  },
  async addManualJob(m) {
    const id = `demo-${jobs.length + 1}`;
    const text = `${m.title} ${m.description}`.toLowerCase();
    const vocab = [...new Set(Object.values(KEYWORDS).flatMap((l) => l.flatMap((k) => [...k.required, ...k.preferred])))];
    const found = vocab.filter((v) => text.includes(v.toLowerCase()));
    const now = new Date().toISOString();
    const job: Job = {
      id, title: m.title, company: m.company, location: m.location || null, city: null, remote: /remote/i.test(m.location),
      apply_url: m.url || null, description: m.description, posted_at: now, track: null, min_years: null, llm_score: null,
      score_reason: null, missing_keywords: [], status: m.tailor ? "tailor_queued" : "new", captured_by: "manual",
      notes: null, applied_at: null, created_at: now, updated_at: now,
      jd_keywords: { required: found.slice(0, 6), preferred: found.slice(6, 9) }, ats_score: null, tailor_requested_at: null,
      job_links: [{ source: "manual", url: m.url || "", url_key: `manual:${id}` }], tailorings: [],
    };
    jobs.unshift(job);
    return id;
  },
  async skillDemand() {
    return demand().sort((a, b) => b.required_by - a.required_by || b.jobs - a.jobs);
  },
  async jobsWithKeywords() {
    return jobs.filter((j) => j.jd_keywords && j.status !== "archived").length;
  },
  async profileSnapshot() {
    return PROFILE;
  },
  async skillStatuses() {
    return skillRows;
  },
  async setSkillStatus(skill, status) {
    skillRows = skillRows.filter((r) => r.skill !== skill);
    if (status) skillRows.push({ skill, status, note: null, updated_at: new Date().toISOString() });
  },
};
