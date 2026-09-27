// Sample data so the dashboard can be previewed (and screenshotted in CI) without a Supabase project.
import type { Api } from "./api";
import type { ApiUsageDay, Balance, CreditBalance, Job, JobStatus, Run, Topup, UsageDay } from "./types";

let seed = 7;
function rand(): number {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const today = new Date();
const iso = (daysAgo: number, hour = 10) => {
  const d = new Date(today);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
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
  "tailored", "tailored", "applied", "applied", "interviewing", "rejected", "skipped"];

const JD = `About the role
We are hiring a backend engineer to build payment and order services.
- Design REST APIs and microservices in Java and Spring Boot
- Own PostgreSQL schemas, migrations and Redis caching
- Run services on Docker with CI in GitHub Actions
Requirements: 2-4 years of experience in backend development.`;

const jobs: Job[] = Array.from({ length: 26 }, (_, i) => {
  const [title, track] = titles[i % titles.length];
  const status = statuses[i % statuses.length];
  const score = Math.round(52 + rand() * 44);
  const company = companies[i % companies.length];
  const srcs = Array.from(new Set([pick(sources), pick(sources)]));
  const created = iso(Math.floor(i / 3), i % 2 ? 22 : 10);
  const tailored = ["tailored", "applied", "interviewing", "rejected"].includes(status);
  return {
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
    missing_keywords: score > 80 ? ["Kafka", "AWS"] : ["Kubernetes", "Kafka", "gRPC"],
    status,
    captured_by: i === 5 ? "extension" : "bot",
    notes: status === "interviewing" ? "Round 1 on Friday, system design." : null,
    applied_at: ["applied", "interviewing", "rejected"].includes(status) ? iso(Math.floor(i / 3) - 1 < 0 ? 0 : Math.floor(i / 3) - 1) : null,
    created_at: created,
    updated_at: created,
    job_links: srcs.map((s, k) => ({ source: s, url: `https://example.com/${s}/${i}`, url_key: `${s}:${i}${k}` })),
    tailorings: tailored
      ? [{
          id: `t-${i}`, job_id: `demo-${i + 1}`, created_at: created, provider: "gemini", model: "gemini-flash-latest",
          status: i % 4 === 0 ? "needs_review" : "ok",
          diagnostics: { match_score: score, missing_keywords: ["Kafka", "AWS", "gRPC", "Kubernetes", "Terraform"],
            red_flags: score < 75 ? ["Asks for 3+ years of Java in production"] : [],
            strong_sections: ["current: Azure Functions and REST APIs map to the platform work"],
            weak_sections: ["previous: front-end work is off-target"] },
          verification: { ats_parser: "Java, Spring Boot, REST, PostgreSQL extracted cleanly; Kafka still absent.",
            hiring_manager: "Summary reads naturally; order-service project leads the projects section." },
          lint_issues: i % 4 === 0 ? [{ code: "stub", where: "project:jobbot#2", message: "project:jobbot#2 ends in a short last line (48% full)", llm_fixable: true }] : [],
          fixes: ["skills: removed items not in your profile vocabulary ['Kafka']"],
          revisions: 1, pages: 1, fill_ratio: 0.97, tex_path: "demo/resume.tex", pdf_path: "demo/resume.pdf",
        }]
      : [],
  };
});

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

const runsData: Run[] = Array.from({ length: 14 }, (_, i) => {
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
});

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
  async getJob(id) {
    await wait();
    return jobs.find((j) => j.id === id) ?? null;
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
};
