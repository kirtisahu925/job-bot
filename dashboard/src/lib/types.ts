export const STATUSES = [
  "new",
  "shortlisted",
  "tailor_queued",
  "tailored",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "skipped",
  "archived",
] as const;
export type JobStatus = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<JobStatus, string> = {
  new: "New",
  shortlisted: "Shortlisted",
  tailor_queued: "Queued for resume",
  tailored: "Resume ready",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  skipped: "Skipped",
  archived: "Archived",
};

export interface JobLink {
  source: string;
  url: string;
  url_key: string;
}

export interface Diagnostics {
  match_score: number;
  missing_keywords: string[];
  red_flags: string[];
  strong_sections: string[];
  weak_sections: string[];
}

export interface LintIssue {
  code: string;
  where: string;
  message: string;
  llm_fixable: boolean;
}

export interface Tailoring {
  id: string;
  job_id: string;
  created_at: string;
  provider: string | null;
  model: string | null;
  status: string | null;
  diagnostics: Diagnostics | null;
  verification: { ats_parser: string; hiring_manager: string } | null;
  lint_issues: LintIssue[] | null;
  fixes: string[] | null;
  revisions: number | null;
  pages: number | null;
  fill_ratio: number | null;
  tex_path: string | null;
  pdf_path: string | null;
}

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string | null;
  city: string | null;
  remote: boolean;
  apply_url: string | null;
  description?: string | null;
  posted_at: string | null;
  track: string | null;
  min_years: number | null;
  llm_score: number | null;
  score_reason: string | null;
  missing_keywords: string[];
  status: JobStatus;
  captured_by: string;
  notes: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
  job_links: JobLink[];
  tailorings: Tailoring[];
}

export interface UsageDay {
  day: string;
  provider: string;
  model: string;
  purpose: string;
  requests: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
  cached_tokens: number;
  cost_usd: number;
  shadow_cost_usd: number;
}

export interface ApiUsageDay {
  day: string;
  source: string;
  calls: number;
  results: number;
  cost_usd: number;
  failures: number;
}

export interface Balance {
  provider: string;
  kind: "money" | "quota";
  unit: string;
  used: number;
  limit_value: number | null;
  remaining: number | null;
  period: string;
  method: "live_api" | "ledger" | "manual";
  note: string | null;
  checked_at: string;
}

export interface CreditBalance {
  provider: string;
  credit_usd: number;
  spent_usd: number;
  balance_usd: number;
  since: string;
}

export interface Topup {
  id: string;
  provider: string;
  amount_usd: number;
  purchased_at: string;
  note: string | null;
}

export interface RunSource {
  source: string;
  status: string;
  calls: number;
  results: number;
  cost_usd: number;
  error: string | null;
}

export interface Run {
  id: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  fetched: number | null;
  new_jobs: number | null;
  scored: number | null;
  tailored: number | null;
  summary: {
    sources?: RunSource[];
    errors?: string[];
    tailor_stopped?: string;
    kept?: number;
    llm?: { requests: number; input_tokens: number; output_tokens: number; thinking_tokens: number; cost_usd: number };
  } | null;
}
