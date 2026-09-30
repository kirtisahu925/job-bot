export const STATUSES = [
  "new",
  "shortlisted",
  "tailor_queued",
  "tailored",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "expired",
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
  expired: "No longer accepting",
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

export interface AtsPart {
  points: number;
  max: number;
  note: string;
}

/** The deterministic ATS score of one tailored resume (jobbot/ats/score.py AtsResult + rounds). */
export interface AtsDetail {
  score: number;
  max_achievable: number;
  target: number;
  breakdown: Record<string, AtsPart>;
  reach?: Record<string, number>;
  matched_required: string[];
  matched_preferred: string[];
  missing_fixable: string[];
  missing_gaps: string[];
  skills_only: string[];
  best_title: string | null;
  rounds?: number[];
}

export const ATS_MINIMUM = 80;

export const ATS_PARTS: { key: string; label: string; short: string }[] = [
  { key: "required", label: "Required skills", short: "Required" },
  { key: "preferred", label: "Preferred skills", short: "Preferred" },
  { key: "title", label: "Job title", short: "Title" },
  { key: "experience", label: "Experience", short: "Exp." },
  { key: "education", label: "Education", short: "Edu." },
  { key: "placement", label: "Skills used in bullets", short: "Use" },
  { key: "format", label: "Format", short: "Format" },
];

export interface JdKeywords {
  required: string[];
  preferred: string[];
  degree_required?: boolean;
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
  ats_score?: number | null;
  ats?: AtsDetail | null;
  /** written from this resume's facts; sentences citing anything else were removed */
  cover_letter?: string | null;
  /** build, hiring manager review, VP of hiring review, fix-up: analysis or findings and ATS each */
  rounds?: RoundRecord[] | null;
}

export interface Finding {
  area: string;
  issue: string;
  fix: string;
  severity: "high" | "medium" | "low";
}

/** One round of a tailored resume (jobbot/tailor/rounds.py round_record). */
export interface RoundRecord {
  name: "build" | "hiring_manager" | "vp_hiring" | "fix";
  title: string;
  ats_score: number | null;
  analysis: {
    role_focus: string;
    must_haves: string[];
    nice_to_haves: string[];
    seniority: string;
    candidate_fit: string[];
    keywords: string[];
    gaps: string[];
    preferences_applied: string[];
    strategy: string;
  } | null;
  review: {
    first_impression: string;
    verdict: "reject" | "maybe" | "interview" | "strong_interview";
    findings: Finding[];
    after: string;
  } | null;
  problems: string[];
  skipped: string | null;
  kept: boolean;
}


export type Verdict = "apply" | "maybe" | "skip";
export type Legitimacy = "high" | "caution" | "suspicious";

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
  jd_keywords?: JdKeywords | null;
  ats_score?: number | null;
  tailor_requested_at?: string | null;
  /** whether to spend an application: skip means do not apply */
  verdict?: Verdict | null;
  /** is this a real, active opening, judged from the posting */
  legitimacy?: Legitimacy | null;
  legitimacy_signals?: string[];
  hard_stops?: string[];
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

export type SkillChoice = "to_learn" | "learning" | "known" | "ignore";

export const SKILL_CHOICE_LABEL: Record<SkillChoice, string> = {
  to_learn: "To learn",
  learning: "Learning",
  known: "I know this",
  ignore: "Ignore",
};

export interface SkillDemand {
  skill_key: string;
  skill: string;
  required_by: number;
  preferred_by: number;
  jobs: number;
  avg_job_score: number | null;
  tracks: string[];
  example_job_ids: string[];
}

export interface SkillStatus {
  skill: string;
  status: SkillChoice;
  note: string | null;
  updated_at: string;
}

export interface ProfileSnapshot {
  headline: string | null;
  years_experience: number | null;
  skills: string[];
  categories: Record<string, string[]> | null;
  updated_at: string;
}

export interface ManualJob {
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
  tailor: boolean;
}
