import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { demoApi } from "./demo";
import type { ApiUsageDay, Balance, CreditBalance, Job, JobStatus, Run, Tailoring, Topup, UsageDay } from "./types";

export interface Api {
  demo: boolean;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  currentEmail(): Promise<string | null>;
  listJobs(): Promise<Job[]>;
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
}

const JOB_LIST_COLUMNS =
  "id,title,company,location,city,remote,apply_url,posted_at,track,min_years,llm_score,score_reason," +
  "missing_keywords,status,captured_by,notes,applied_at,created_at,updated_at," +
  "job_links(source,url,url_key),tailorings(id,job_id,created_at,status,pdf_path,tex_path,diagnostics)";

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
  };
}

function sortTailorings(job: Job): Job {
  const tailorings = [...(job.tailorings ?? [])].sort((a: Tailoring, b: Tailoring) =>
    b.created_at.localeCompare(a.created_at),
  );
  return { ...job, tailorings, job_links: job.job_links ?? [], missing_keywords: job.missing_keywords ?? [] };
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const demo = import.meta.env.VITE_DEMO === "1" || !url || !key;

export const api: Api = demo ? demoApi : supabaseApi(createClient(url!, key!));

export const nextStatusActions: Partial<Record<JobStatus, JobStatus[]>> = {
  new: ["shortlisted", "tailor_queued", "skipped"],
  shortlisted: ["tailor_queued", "applied", "skipped"],
  tailored: ["applied", "tailor_queued", "skipped"],
  applied: ["interviewing", "rejected"],
  interviewing: ["offer", "rejected"],
};
