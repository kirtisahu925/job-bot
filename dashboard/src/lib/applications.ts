// What to do next about each application. The same follow-up rhythm as the Contacts playbook:
// chase every 2-3 days once they talk to you, say yes to a face-to-face interview, and never go quiet.
import type { Job, JobStatus } from "./types";

export const APPLICATION_STATUSES: JobStatus[] = ["applied", "interviewing", "offer", "rejected"];
export const ACTIVE_APPLICATION: JobStatus[] = ["applied", "interviewing", "offer"];

const DAY = 86_400_000;
export const FIRST_FOLLOW_UP_DAYS = 3; // follow up actively, every 2-3 days
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
