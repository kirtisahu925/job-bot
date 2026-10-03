// Data for the Companies, Preferences, Settings, Activity and Applications pages
// (supabase/migrations/0008_pages.sql), with sample data in demo mode.
import { api, supabase } from "./api";
import type { JobStatus, RoundRecord, Run } from "./types";

export type Board = "greenhouse" | "lever" | "ashby";

export interface Company {
  id: string;
  name: string;
  category: string | null;
  salary_min_lpa: number | null;
  salary_max_lpa: number | null;
  salary_source: string | null;
  careers_url: string | null;
  board: Board | null;
  board_slug: string | null;
  target: boolean;
  notes: string | null;
  updated_at: string;
}

export type CompanyInput = Omit<Company, "id" | "updated_at">;

/** Mirrors jobbot/preferences.py Preferences: blank fields keep config/search.yaml. */
export interface Preferences {
  target_level: string;
  target_roles: string[];
  emphasize: string[];
  de_emphasize: string[];
  resume_notes: string;
  tracks: string[];
  cities: string[];
  include_remote: boolean | null;
  max_required_years: number | null;
  exclude_title_words: string[];
  min_salary_lpa: number | null;
  /** Only jobs posted within this many days are fetched and scored; null keeps each site's own window. */
  max_job_age_days: JobAge | null;
  /** deal-breakers, dropped before any AI call */
  skip_companies: string[];
  skip_phrases: string[];
  skip_it_services: boolean | null;
}

export type JobAge = 1 | 3 | 7 | 30;

export type Reviewer = "hiring_manager" | "vp_hiring";

/** Mirrors jobbot/preferences.py BotSettings: null keeps the repo's config. */
export interface BotSettings {
  llm_provider: "gemini" | "anthropic" | null;
  claude_model: "claude-opus-5-5" | "claude-sonnet-5-5" | null;
  ats_target: number | null;
  ats_minimum: number | null;
  reviewers: Reviewer[] | null;
  fix_rounds: number | null;
  tailor_per_run: number | null;
  min_score: number | null;
  cover_letter: boolean | null;
}

export interface UserSettings {
  preferences: Partial<Preferences>;
  settings: Partial<BotSettings>;
  updated_at: string | null;
}

export interface JobEvent {
  id: string;
  job_id: string;
  at: string;
  kind: "saved" | "status";
  from_status: JobStatus | null;
  to_status: JobStatus | null;
  job: { title: string; company: string } | null;
}

export interface ResumeEvent {
  id: string;
  job_id: string;
  created_at: string;
  ats_score: number | null;
  status: string | null;
  rounds: RoundRecord[] | null;
  job: { title: string; company: string } | null;
}

export interface WorkspaceApi {
  companies(): Promise<Company[]>;
  saveCompany(id: string | null, c: Partial<CompanyInput>): Promise<Company>;
  deleteCompany(id: string): Promise<void>;
  userSettings(): Promise<UserSettings>;
  savePreferences(p: Partial<Preferences>): Promise<void>;
  saveSettings(s: Partial<BotSettings>): Promise<void>;
  jobEvents(limit: number): Promise<JobEvent[]>;
  resumes(limit: number): Promise<ResumeEvent[]>;
  runs(limit: number): Promise<Run[]>;
}

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

const COMPANY_COLUMNS =
  "id,name,category,salary_min_lpa,salary_max_lpa,salary_source,careers_url,board,board_slug,target,notes,updated_at";

function supabaseWorkspace(client: NonNullable<typeof supabase>): WorkspaceApi {
  return {
    async companies() {
      return must(await client.from("companies").select(COMPANY_COLUMNS).order("name")) as Company[];
    },
    async saveCompany(id, c) {
      const q = id ? client.from("companies").update(c).eq("id", id) : client.from("companies").insert(c);
      const rows = must(await q.select(COMPANY_COLUMNS)) as Company[];
      return rows[0];
    },
    async deleteCompany(id) {
      must(await client.from("companies").delete().eq("id", id));
    },
    async userSettings() {
      const row = must(await client.from("user_settings").select("preferences,settings,updated_at").eq("id", 1).maybeSingle()) as UserSettings | null;
      return row ?? { preferences: {}, settings: {}, updated_at: null };
    },
    async savePreferences(preferences) {
      must(await client.from("user_settings").upsert({ id: 1, preferences }, { onConflict: "id" }));
    },
    async saveSettings(settings) {
      must(await client.from("user_settings").upsert({ id: 1, settings }, { onConflict: "id" }));
    },
    async jobEvents(limit) {
      return must(
        await client.from("job_events").select("id,job_id,at,kind,from_status,to_status,job:jobs(title,company)").order("at", { ascending: false }).limit(limit),
      ) as unknown as JobEvent[];
    },
    async resumes(limit) {
      return must(
        await client
          .from("tailorings")
          .select("id,job_id,created_at,ats_score,status,rounds,job:jobs(title,company)")
          .order("created_at", { ascending: false })
          .limit(limit),
      ) as unknown as ResumeEvent[];
    },
    runs: (limit) => api.runs(limit),
  };
}

// demo ---------------------------------------------------------------------------------------------

const SRC = "hey.aanchal (Instagram)";
// the salary post's brackets (a subset), plus a board and a target to show those states
const DEMO_COMPANIES: [string, string, number, number][] = [
  ["Atlassian", "Dev tools & SaaS", 40, 70],
  ["Postman", "Dev tools & SaaS", 35, 60],
  ["BrowserStack", "Dev tools & SaaS", 30, 50],
  ["Salesforce", "Enterprise software", 30, 60],
  ["Adobe", "Enterprise software", 30, 55],
  ["Walmart Global Tech", "Retail tech", 30, 50],
  ["JPMorgan Chase", "Banking & finance", 35, 60],
  ["Goldman Sachs", "Banking & finance", 40, 70],
  ["American Express", "Banking & finance", 30, 50],
  ["Razorpay", "Fintech", 30, 45],
  ["PhonePe", "Fintech", 30, 45],
  ["Stripe", "Fintech", 35, 60],
  ["Snowflake", "Data & infrastructure", 50, 90],
  ["Databricks", "Data & infrastructure", 45, 80],
  ["Confluent", "Data & infrastructure", 40, 70],
  ["NVIDIA", "Semiconductors", 40, 80],
  ["Okta", "Security", 25, 45],
  ["Microsoft", "Big tech", 30, 60],
  ["Google", "Big tech", 30, 60],
  ["Amazon", "Big tech", 30, 50],
  ["Flipkart", "Consumer internet", 30, 45],
  ["Swiggy", "Consumer internet", 30, 45],
  ["Thoughtworks", "IT services & consulting", 30, 45],
  ["EPAM Systems", "IT services & consulting", 30, 45],
];

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

let demoCompanies: Company[] = [
  ...DEMO_COMPANIES.map(([name, category, lo, hi], i) => ({
    id: `c-${i}`,
    name,
    category,
    salary_min_lpa: lo,
    salary_max_lpa: hi,
    salary_source: SRC,
    careers_url: null,
    board: null,
    board_slug: null,
    target: name === "Stripe" || name === "Postman",
    notes: null,
    updated_at: hoursAgo(48),
  })),
  {
    id: "c-remote",
    name: "Remote",
    category: "Remote-first",
    salary_min_lpa: null,
    salary_max_lpa: null,
    salary_source: null,
    careers_url: "https://job-boards.greenhouse.io/remotecom",
    board: "greenhouse",
    board_slug: "remotecom",
    target: false,
    notes: null,
    updated_at: hoursAgo(2),
  },
];

let demoSettings: UserSettings = {
  preferences: { target_level: "SDE-2", target_roles: ["Backend Engineer", "Software Development Engineer II"], emphasize: ["Java and Spring Boot", "production ownership"], max_job_age_days: 3 },
  settings: {},
  updated_at: null,
};

const demoWorkspace: WorkspaceApi = {
  async companies() {
    return [...demoCompanies].sort((a, b) => a.name.localeCompare(b.name));
  },
  async saveCompany(id, c) {
    if (id) {
      demoCompanies = demoCompanies.map((x) => (x.id === id ? { ...x, ...c, updated_at: new Date().toISOString() } : x));
      return demoCompanies.find((x) => x.id === id)!;
    }
    const row: Company = {
      id: `c-${Date.now()}`,
      name: c.name ?? "Company",
      category: null,
      salary_min_lpa: null,
      salary_max_lpa: null,
      salary_source: null,
      careers_url: null,
      board: null,
      board_slug: null,
      target: false,
      notes: null,
      ...c,
      updated_at: new Date().toISOString(),
    };
    demoCompanies = [...demoCompanies, row];
    return row;
  },
  async deleteCompany(id) {
    demoCompanies = demoCompanies.filter((c) => c.id !== id);
  },
  async userSettings() {
    return demoSettings;
  },
  async savePreferences(preferences) {
    demoSettings = { ...demoSettings, preferences, updated_at: new Date().toISOString() };
  },
  async saveSettings(settings) {
    demoSettings = { ...demoSettings, settings, updated_at: new Date().toISOString() };
  },
  async jobEvents() {
    const jobs = await api.listJobs();
    const out: JobEvent[] = [];
    jobs.forEach((j, i) => {
      if (["applied", "interviewing", "offer", "rejected", "expired"].includes(j.status)) {
        out.push({ id: `e-${j.id}`, job_id: j.id, at: j.updated_at, kind: "status", from_status: "tailored", to_status: j.status, job: { title: j.title, company: j.company } });
      }
      if (j.captured_by !== "bot") {
        out.push({ id: `s-${j.id}`, job_id: j.id, at: hoursAgo(30 + i), kind: "saved", from_status: null, to_status: "new", job: { title: j.title, company: j.company } });
      }
    });
    return out.sort((a, b) => b.at.localeCompare(a.at));
  },
  async resumes() {
    const jobs = await api.listJobs();
    return jobs
      .flatMap((j) => j.tailorings.map((t) => ({ ...t, job: { title: j.title, company: j.company } })))
      .map((t) => ({
        id: t.id,
        job_id: t.job_id,
        created_at: t.created_at,
        ats_score: t.ats_score ?? null,
        status: t.status,
        rounds: t.rounds ?? null,
        job: t.job,
      }));
  },
  runs: (limit) => api.runs(limit),
};

export const workspaceApi: WorkspaceApi = supabase ? supabaseWorkspace(supabase) : demoWorkspace;
