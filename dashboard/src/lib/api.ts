import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { demoApi } from "./demo";
import type {
  ApiUsageDay,
  Balance,
  CreditBalance,
  Job,
  JobStatus,
  ManualJob,
  ProfileSnapshot,
  Run,
  SkillChoice,
  SkillDemand,
  SkillStatus,
  Tailoring,
  Topup,
  UsageDay,
} from "./types";

export interface Api {
  demo: boolean;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  currentEmail(): Promise<string | null>;
  listJobs(): Promise<Job[]>;
  /** Sidebar counts: resumes ready to apply with, and jobs waiting for triage. */
  counts(): Promise<{ ready: number; triage: number }>;
  getJob(id: string): Promise<Job | null>;
  updateJob(id: string, patch: Partial<Pick<Job, "status" | "notes">>): Promise<void>;
  signedUrl(path: string): Promise<string>;
  usageDaily(sinceDay: string): Promise<UsageDay[]>;
  apiUsageDaily(sinceDay: string): Promise<ApiUsageDay[]>;
  latestBalances(): Promise<Balance[]>;
  creditBalances(): Promise<CreditBalance[]>;
  topups(): Promise<Topup[]>;
  addTopup(t: Omit<Topup, "id">): Promise<void>;
  deleteTopup(id: string): Promise<void>;
  runs(limit: number): Promise<Run[]>;
  /** Start the GitHub Action that tailors this job now (about 3 minutes). Resolves to a message to show. */
  tailorNow(jobId: string): Promise<string>;
  /** Save a job pasted by hand; returns its id. */
  addManualJob(job: ManualJob): Promise<string>;
  skillDemand(): Promise<SkillDemand[]>;
  jobsWithKeywords(): Promise<number>;
  profileSnapshot(): Promise<ProfileSnapshot | null>;
  skillStatuses(): Promise<SkillStatus[]>;
  setSkillStatus(skill: string, status: SkillChoice | null): Promise<void>;
}

const JOB_LIST_COLUMNS =
  "id,title,company,location,city,remote,apply_url,posted_at,track,min_years,llm_score,score_reason," +
  "missing_keywords,status,captured_by,notes,applied_at,created_at,updated_at,ats_score,tailor_requested_at," +
  "verdict,legitimacy,legitimacy_signals,hard_stops," +
  "job_links(source,url,url_key),tailorings(id,job_id,created_at,status,pdf_path,tex_path,ats_score)";

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

function supabaseApi(client: SupabaseClient): Api {
  return {
    demo: false,
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
    },
    async signOut() {
      await client.auth.signOut();
    },
    async currentEmail() {
      const { data } = await client.auth.getSession();
      return data.session?.user.email ?? null;
    },
    async listJobs() {
      const rows = must(
        await client.from("jobs").select(JOB_LIST_COLUMNS).order("created_at", { ascending: false }).limit(1000),
      );
      return (rows as unknown as Job[]).map(sortTailorings);
    },
    async getJob(id) {
      const rows = must(
        await client
          .from("jobs")
          .select("*,job_links(source,url,url_key),tailorings(*)")
          .eq("id", id)
          .limit(1),
      );
      const job = (rows as unknown as Job[])[0];
      return job ? sortTailorings(job) : null;
    },
    async updateJob(id, patch) {
      must(await client.from("jobs").update(patch).eq("id", id));
    },
    async signedUrl(path) {
      const { data, error } = await client.storage.from("resumes").createSignedUrl(path, 3600);
      if (error || !data) throw new Error(error?.message ?? "could not sign URL");
      return data.signedUrl;
    },
    async usageDaily(sinceDay) {
      return must(await client.from("usage_daily").select("*").gte("day", sinceDay)) as UsageDay[];
    },
    async apiUsageDaily(sinceDay) {
      return must(await client.from("api_usage_daily").select("*").gte("day", sinceDay)) as ApiUsageDay[];
    },
    async latestBalances() {
      return must(await client.from("latest_balances").select("*")) as Balance[];
    },
    async creditBalances() {
      return must(await client.from("credit_balance").select("*")) as CreditBalance[];
    },
    async topups() {
      return must(await client.from("credit_topups").select("*").order("purchased_at", { ascending: false })) as Topup[];
    },
    async addTopup(t) {
      must(await client.from("credit_topups").insert(t));
    },
    async deleteTopup(id) {
      must(await client.from("credit_topups").delete().eq("id", id));
    },
    async runs(limit) {
      return must(await client.from("runs").select("*").order("started_at", { ascending: false }).limit(limit)) as Run[];
    },
    async tailorNow(jobId) {
      const { data, error } = await client.functions.invoke("tailor-now", { body: { job_id: jobId } });
      if (error) {
        // FunctionsHttpError carries the function's JSON body; show its message, not "non-2xx status code"
        const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(body?.error ?? error.message);
      }
      return (data as { message?: string })?.message ?? "Tailoring started.";
    },
    async addManualJob(job) {
      const id = must(
        await client.rpc("capture_job", {
          p_title: job.title,
          p_company: job.company,
          p_location: job.location || null,
          p_description: job.description,
          p_url: job.url || null,
          p_url_key: `manual:${crypto.randomUUID()}`,
          p_source: "manual",
          p_queue: job.tailor,
        }),
      ) as string;
      return id;
    },
    async skillDemand() {
      return must(
        await client.from("skill_demand").select("*").order("required_by", { ascending: false }).limit(500),
      ) as SkillDemand[];
    },
    async counts() {
      const count = async (statuses: string[]) => {
        const { count: n, error } = await client.from("jobs").select("id", { count: "exact", head: true }).in("status", statuses);
        if (error) throw new Error(error.message);
        return n ?? 0;
      };
      const [ready, triage] = await Promise.all([count(["tailored"]), count(["new", "shortlisted", "tailor_queued"])]);
      return { ready, triage };
    },
    async jobsWithKeywords() {
      const row = must(await client.from("skill_demand_total").select("jobs_with_keywords").maybeSingle()) as {
        jobs_with_keywords: number;
      } | null;
      return row?.jobs_with_keywords ?? 0;
    },
    async profileSnapshot() {
      return must(await client.from("profile_snapshot").select("*").maybeSingle()) as ProfileSnapshot | null;
    },
    async skillStatuses() {
      return must(await client.from("skill_status").select("*")) as SkillStatus[];
    },
    async setSkillStatus(skill, status) {
      if (status === null) must(await client.from("skill_status").delete().eq("skill", skill));
      else
        must(
          await client
            .from("skill_status")
            .upsert({ skill, status, updated_at: new Date().toISOString() }, { onConflict: "skill" }),
        );
    },
  };
}

function sortTailorings(job: Job): Job {
  const tailorings = [...(job.tailorings ?? [])].sort((a: Tailoring, b: Tailoring) =>
    b.created_at.localeCompare(a.created_at),
  );
  return {
    ...job,
    tailorings,
    job_links: job.job_links ?? [],
    missing_keywords: job.missing_keywords ?? [],
    legitimacy_signals: job.legitimacy_signals ?? [],
    hard_stops: job.hard_stops ?? [],
  };
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const demo = import.meta.env.VITE_DEMO === "1" || !url || !key;

/** The signed-in Supabase client (null in demo mode); the Contacts module shares it. */
export const supabase: SupabaseClient | null = demo ? null : createClient(url!, key!);
export const api: Api = supabase ? supabaseApi(supabase) : demoApi;

export const nextStatusActions: Partial<Record<JobStatus, JobStatus[]>> = {
  new: ["shortlisted", "tailor_queued", "expired", "skipped"],
  shortlisted: ["tailor_queued", "applied", "expired", "skipped"],
  tailored: ["applied", "tailor_queued", "expired", "skipped"],
  applied: ["interviewing", "rejected"],
  interviewing: ["offer", "rejected"],
};
