// What to do next about each application. The same follow-up rhythm as the Contacts playbook:
// chase every 2-3 days once they talk to you, say yes to a face-to-face interview, and never go quiet.
import type { Job, JobStatus } from "./types";

export const APPLICATION_STATUSES: JobStatus[] = ["applied", "interviewing", "offer", "rejected"];
export const ACTIVE_APPLICATION: JobStatus[] = ["applied", "interviewing", "offer"];

const DAY = 86_400_000;
export const FIRST_FOLLOW_UP_DAYS = 3; // follow up actively, every 2-3 days
export const GHOSTED_DAYS = 21; // no reply three weeks after applying: count it as ghosted
export const FAST_REJECTION_DAYS = 2; // a rejection this soon is usually an automated screen
export const INTERVIEW_CHECK_IN_DAYS = 3;

export interface NextStep {
  action: string;
  why: string;
  due: Date | null;
}

/** When the job reached its current stage: applied_at for "applied", otherwise the last update. */
export function stageSince(job: Pick<Job, "status" | "applied_at" | "updated_at">): Date {
  return new Date(job.status === "applied" && job.applied_at ? job.applied_at : job.updated_at);
}

export function daysSince(d: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / DAY));
}

export function nextStepFor(
  job: Pick<Job, "status" | "applied_at" | "updated_at" | "company">,
  opts: { now?: Date; bracket?: string | null; hasContacts?: boolean } = {},
): NextStep {
  const now = opts.now ?? new Date();
  const since = stageSince(job);
  const days = daysSince(since, now);
  const at = (d: number) => new Date(since.getTime() + d * DAY);
  // the latest 2-3 day mark: due today, a day or two overdue, or (before the first mark) still ahead
  const every = (n: number) => at(n * Math.max(1, Math.floor(days / n)));
  switch (job.status) {
    case "applied":
      if (days >= GHOSTED_DAYS)
        return {
          action: "Likely ghosted",
          why: `${days} days without a reply. Send one last short follow-up, then put your time into newer applications.`,
          due: null,
        };
      return days >= FIRST_FOLLOW_UP_DAYS
        ? {
            action: opts.hasContacts ? `Follow up with your contact at ${job.company}` : `Follow up with a recruiter at ${job.company}`,
            why: `${days} days without a reply. Every 2-3 days: LinkedIn first, then e-mail, then WhatsApp; call if none of them answer.`,
            due: every(FIRST_FOLLOW_UP_DAYS),
          }
        : {
            action: "Wait for a reply",
            why: `Applied ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}. Follow up on day ${FIRST_FOLLOW_UP_DAYS} if you hear nothing.`,
            due: at(FIRST_FOLLOW_UP_DAYS),
          };
    case "interviewing":
      return {
        action: "Check in and prepare",
        why: "Check in every 2-3 days. If they ask, say yes to a face-to-face round: offering only virtual can cost you the slot.",
        due: every(INTERVIEW_CHECK_IN_DAYS),
      };
    case "offer":
      return {
        action: "Weigh the offer",
        why: opts.bracket ? `Compare it with ${job.company}'s bracket on the Companies page: ${opts.bracket} LPA.` : "Compare it with what similar companies pay on the Companies page.",
        due: null,
      };
    case "rejected":
      return { action: "Ask for feedback", why: "A short, polite note asking what to improve; then move on.", due: null };
    default:
      return { action: "", why: "", due: null };
  }
}

export interface Funnel {
  total: number;
  waiting: number;
  interviewing: number;
  offers: number;
  rejected: number;
  /** interviews, offers and rejections: the companies that answered at all */
  heardBack: number;
}

export function funnel(jobs: Pick<Job, "status">[]): Funnel {
  const count = (s: JobStatus) => jobs.filter((j) => j.status === s).length;
  const f = { total: 0, waiting: count("applied"), interviewing: count("interviewing"), offers: count("offer"), rejected: count("rejected"), heardBack: 0 };
  f.total = f.waiting + f.interviewing + f.offers + f.rejected;
  f.heardBack = f.interviewing + f.offers + f.rejected;
  return f;
}

// The weekly review: how applications are doing, where replies come from, and what a pattern of rejections
// suggests. A finding needs enough data behind it; otherwise the review says there is no clear pattern yet.
export interface StatusEvent {
  job_id: string;
  at: string;
  to_status: JobStatus | null;
}

type ReviewJob = Pick<Job, "id" | "status" | "applied_at" | "updated_at" | "captured_by"> & { job_links: { source: string }[] };

export interface SourceRow {
  source: string;
  applied: number;
  replies: number;
}

export interface Review {
  applied: number;
  replies: number;
  interviews: number;
  ghosted: number;
  medianDaysToReply: number | null;
  bySource: SourceRow[];
  findings: string[];
}

const REPLY: JobStatus[] = ["interviewing", "offer", "rejected"];
const pct = (n: number, of: number) => `${Math.round((n / of) * 100)}%`;

export function sourceOf(job: ReviewJob): string {
  return job.job_links[0]?.source ?? (job.captured_by === "bot" ? "unknown" : job.captured_by);
}

export function review(jobs: ReviewJob[], events: StatusEvent[], opts: { now?: Date; label?: (source: string) => string } = {}): Review {
  const now = opts.now ?? new Date();
  const label = opts.label ?? ((s: string) => s);
  const apps = jobs.filter((j) => APPLICATION_STATUSES.includes(j.status));
  const byJob = new Map<string, StatusEvent[]>();
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) byJob.set(e.job_id, [...(byJob.get(e.job_id) ?? []), e]);

  let interviews = 0;
  let fast = 0;
  let afterInterview = 0;
  const waits: number[] = [];
  for (const j of apps) {
    const history = byJob.get(j.id) ?? [];
    const interviewed = j.status === "interviewing" || j.status === "offer" || history.some((e) => e.to_status === "interviewing");
    if (interviewed) interviews += 1;
    const applied = j.applied_at ? new Date(j.applied_at) : null;
    const reply = applied && history.find((e) => e.to_status && REPLY.includes(e.to_status) && new Date(e.at) >= applied);
    if (applied && reply) waits.push((new Date(reply.at).getTime() - applied.getTime()) / DAY);
    if (j.status === "rejected") {
      if (interviewed) afterInterview += 1;
      const rejectedAt = [...history].reverse().find((e) => e.to_status === "rejected");
      if (!interviewed && applied && rejectedAt && (new Date(rejectedAt.at).getTime() - applied.getTime()) / DAY <= FAST_REJECTION_DAYS) fast += 1;
    }
  }
  const replies = apps.filter((j) => REPLY.includes(j.status)).length;
  const rejected = apps.filter((j) => j.status === "rejected").length;
  const ghosted = apps.filter((j) => j.status === "applied" && daysSince(stageSince(j), now) >= GHOSTED_DAYS).length;
  const sorted = [...waits].sort((a, b) => a - b);
  const medianDaysToReply = sorted.length ? Math.round(sorted[Math.floor((sorted.length - 1) / 2)]) : null;

  const rows = new Map<string, SourceRow>();
  for (const j of apps) {
    const s = sourceOf(j);
    const row = rows.get(s) ?? { source: s, applied: 0, replies: 0 };
    row.applied += 1;
    if (REPLY.includes(j.status)) row.replies += 1;
    rows.set(s, row);
  }
  const bySource = [...rows.values()].sort((a, b) => b.applied - a.applied || a.source.localeCompare(b.source));

  const findings: string[] = [];
  if (fast >= 3 && fast * 2 >= rejected)
    findings.push(
      `${fast} of your ${rejected} rejections came within ${FAST_REJECTION_DAYS} days of applying: that is usually an automated screen, not a person. Raise the ATS minimum in Settings and apply where the resume clears it.`,
    );
  if (afterInterview >= 2)
    findings.push(
      `${afterInterview} rejections came after an interview, so the resume is getting you in. Put the effort into interview practice for these stacks rather than into the resume.`,
    );
  if (apps.length >= 15 && replies / apps.length < 0.1)
    findings.push(
      `Only ${pct(replies, apps.length)} of ${apps.length} applications got any reply. Check the targeting: the titles and seniority you apply to, and whether the ATS score was under 80 when you applied.`,
    );
  const sizable = bySource.filter((r) => r.applied >= 5);
  if (sizable.length >= 2) {
    const rate = (r: SourceRow) => r.replies / r.applied;
    const best = sizable.reduce((a, b) => (rate(b) > rate(a) ? b : a));
    const worst = sizable.reduce((a, b) => (rate(b) < rate(a) ? b : a));
    if (best !== worst && best.replies >= 2 && rate(best) >= 2 * rate(worst))
      findings.push(
        rate(worst)
          ? `${label(best.source)} replies ${(rate(best) / rate(worst)).toFixed(1)}x as often as ${label(worst.source)} (${pct(best.replies, best.applied)} vs ${pct(worst.replies, worst.applied)}): apply there first.`
          : `${label(best.source)} answered ${pct(best.replies, best.applied)} of your applications and ${label(worst.source)} none of ${worst.applied}: apply on ${label(best.source)} first.`,
      );
  }
  if (ghosted >= 3)
    findings.push(`${ghosted} applications have had no reply for 3 weeks or more. Send each one last follow-up, then move on.`);
  if (!findings.length)
    findings.push(
      apps.length >= 5
        ? "No clear pattern yet: the replies so far look like normal variance."
        : "Too few applications to see a pattern yet. This review fills in as you apply.",
    );
  return { applied: apps.length, replies, interviews, ghosted, medianDaysToReply, bySource, findings };
}
