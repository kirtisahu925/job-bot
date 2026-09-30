// The follow-up rule: reach each contact first on LinkedIn (an invite, or an InMail with Premium), then by cold
// e-mail, then on WhatsApp, and only then by a call, one step every 2-3 days. Channels a contact has no details
// for are skipped. Once they reply, follow up every 2-3 days on the channel they answered on.

export type Channel = "linkedin" | "email" | "whatsapp" | "call";
export const LADDER: Channel[] = ["linkedin", "email", "whatsapp", "call"];
export const CHANNEL_LABEL: Record<Channel, string> = {
  linkedin: "LinkedIn",
  email: "E-mail",
  whatsapp: "WhatsApp",
  call: "Call",
};

export type ContactStatus = "new" | "reaching_out" | "in_touch" | "interviewing" | "closed" | "do_not_contact";
export const STATUS_LABEL: Record<ContactStatus, string> = {
  new: "Not contacted",
  reaching_out: "Reaching out",
  in_touch: "In touch",
  interviewing: "Interviewing",
  closed: "Closed",
  do_not_contact: "Do not contact",
};

export type TouchOutcome =
  | "sent" // a message or e-mail you sent
  | "invite_sent" // a LinkedIn connection request
  | "accepted" // they accepted it
  | "replied" // they wrote back
  | "no_answer" // a call nobody picked up
  | "call_scheduled"
  | "interview"
  | "not_interested";

export const OUTCOME_LABEL: Record<TouchOutcome, string> = {
  sent: "Sent",
  invite_sent: "Invite sent",
  accepted: "Accepted your invite",
  replied: "Replied",
  no_answer: "No answer",
  call_scheduled: "Call scheduled",
  interview: "Interview scheduled",
  not_interested: "Not interested",
};

/** Outcomes that mean the contact answered. */
export const INBOUND: TouchOutcome[] = ["accepted", "replied", "call_scheduled", "interview", "not_interested"];

export interface TouchLike {
  channel: Channel;
  outcome: TouchOutcome;
  at: string;
}

export interface ContactLike {
  name: string | null;
  company?: string | null;
  status: ContactStatus;
  phones: { number: string; whatsapp: boolean }[];
  emails: string[];
  linkedin_url: string | null;
}

export interface NextStep {
  channel: Channel | null;
  due: Date | null;
  /** what to do, in a few words: "Send a LinkedIn invite", "Follow up on WhatsApp" */
  action: string;
  why: string;
}

const DAY = 86_400_000;

/** The channels this contact can be reached on, in the order the rule tries them. LinkedIn needs a profile link,
 * or a name and a company to search for (a first name alone finds thousands of people). */
export function channelsFor(c: ContactLike): Channel[] {
  return LADDER.filter((ch) => {
    if (ch === "linkedin") return !!c.linkedin_url || (!!c.name && !!c.company);
    if (ch === "email") return c.emails.length > 0;
    if (ch === "whatsapp") return c.phones.some((p) => p.whatsapp);
    return c.phones.length > 0;
  });
}

function verb(channel: Channel, first: boolean): string {
  if (channel === "linkedin") return first ? "Send a LinkedIn invite" : "Follow up on LinkedIn";
  if (channel === "email") return first ? "Send a cold e-mail" : "Follow up by e-mail";
  if (channel === "whatsapp") return first ? "Send a WhatsApp message" : "Follow up on WhatsApp";
  return first ? "Call them" : "Call again";
}

/**
 * The next step for a contact from its history. `gap` is the follow-up interval in days (2 or 3).
 * Touches may be in any order.
 */
export function nextStep(contact: ContactLike, touches: TouchLike[], now: Date = new Date(), gap = 2): NextStep {
  if (contact.status === "closed" || contact.status === "do_not_contact") {
    return { channel: null, due: null, action: "Nothing to do", why: STATUS_LABEL[contact.status] };
  }
  const ways = channelsFor(contact);
  if (!ways.length) {
    return { channel: null, due: null, action: "Add a way to reach them", why: "No number, e-mail or LinkedIn profile yet" };
  }
  const sorted = [...touches].sort((a, b) => a.at.localeCompare(b.at));
  const last = sorted[sorted.length - 1];
  const lastIn = [...sorted].reverse().find((t) => INBOUND.includes(t.outcome));
  const lastOut = [...sorted].reverse().find((t) => !INBOUND.includes(t.outcome));
  const after = (t: TouchLike, days: number) => new Date(Date.parse(t.at) + days * DAY);

  if (!last) return { channel: ways[0], due: now, action: verb(ways[0], true), why: "Not contacted yet" };

  // they answered: keep the conversation going where they answered
  if (lastIn) {
    const where = ways.includes(lastIn.channel) ? lastIn.channel : ways[0];
    if (last === lastIn) {
      if (lastIn.outcome === "accepted") {
        return { channel: "linkedin", due: now, action: "Message them on LinkedIn", why: "They accepted your invite" };
      }
      if (lastIn.outcome === "interview" || lastIn.outcome === "call_scheduled") {
        const what = lastIn.outcome === "interview" ? "interview" : "call";
        return { channel: where, due: after(lastIn, gap), action: `Check in about the ${what}`, why: `${what === "interview" ? "Interview" : "Call"} scheduled: stay in touch every 2-3 days` };
      }
      return { channel: where, due: now, action: `Reply on ${CHANNEL_LABEL[where]}`, why: "They wrote back" };
    }
    const why = contact.status === "interviewing" ? "Interview in progress: check in every 2-3 days" : "In touch: follow up every 2-3 days";
    return { channel: where, due: after(last, gap), action: verb(where, false), why };
  }

  // no answer yet: wait, then move one step down the ladder (back to the top after a call)
  const outs = sorted.filter((t) => !INBOUND.includes(t.outcome));
  const rounds = Math.floor(outs.length / ways.length);
  const at = ways.indexOf(lastOut!.channel);
  const next = ways[(at + 1) % ways.length];
  // a LinkedIn invite gets an extra day to be accepted
  const wait = lastOut!.outcome === "invite_sent" ? gap + 1 : gap;
  if (rounds >= 2) {
    return {
      channel: next,
      due: after(lastOut!, 7),
      action: verb(next, false),
      why: `No reply after ${outs.length} attempts on every channel: try once a week, or close it`,
    };
  }
  const why =
    at + 1 >= ways.length
      ? `No reply on any channel yet: start again with ${CHANNEL_LABEL[next]}`
      : `No reply on ${CHANNEL_LABEL[lastOut!.channel]} after ${wait} days`;
  return { channel: next, due: after(lastOut!, wait), action: verb(next, !outs.some((t) => t.channel === next)), why };
}

/** The status a contact moves to after this touch. */
export function statusAfter(current: ContactStatus, outcome: TouchOutcome): ContactStatus {
  if (current === "do_not_contact") return current;
  if (outcome === "not_interested") return "closed";
  if (outcome === "interview" || outcome === "call_scheduled") return "interviewing";
  if (outcome === "replied" || outcome === "accepted") return current === "interviewing" ? current : "in_touch";
  return current === "new" ? "reaching_out" : current;
}

/** "overdue 3d", "today", "in 2d" */
export function dueLabel(due: Date | null, now: Date = new Date()): string {
  if (!due) return "";
  const days = Math.floor((due.getTime() - now.getTime()) / DAY);
  const sameDay = due.toDateString() === now.toDateString();
  if (sameDay || (days === 0 && due <= now)) return "today";
  if (due < now) return `overdue ${Math.max(1, Math.round((now.getTime() - due.getTime()) / DAY))}d`;
  return `in ${Math.max(1, Math.ceil((due.getTime() - now.getTime()) / DAY))}d`;
}
