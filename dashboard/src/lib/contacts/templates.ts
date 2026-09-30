// Ready-to-send messages for each channel, filled from your outreach details and the contact. Nothing is sent
// from here: each opens in LinkedIn, your mail app or WhatsApp with the text in place, and you press Send.

import type { Channel } from "./cadence";

export interface Sender {
  my_name: string | null;
  my_email: string | null;
  my_phone: string | null;
  my_linkedin: string | null;
  headline: string | null; // "Backend Software Engineer"
  pitch: string | null; // one line: "2.4 years building Java / Spring Boot and Azure Functions services"
  target_role: string | null; // "Backend Engineer (Java)"
  resume_url: string | null;
}

export interface Recipient {
  name: string | null;
  company: string | null;
  kind: "hr" | "recruiter" | "consultant" | "leader";
}

export interface Message {
  channel: Channel;
  label: string;
  subject?: string;
  body: string;
  limit?: number; // characters the channel allows (LinkedIn invite notes: 300)
}

const first = (name: string | null) => (name ? name.split(/\s+/)[0] : null);
const hi = (r: Recipient) => (first(r.name) ? `Hi ${first(r.name)}` : "Hi");
const at = (r: Recipient) => (r.company ? ` at ${r.company}` : "");
const role = (s: Sender) => s.target_role || "backend engineering";
const me = (s: Sender) => s.my_name || "a backend engineer";
const pitch = (s: Sender) => s.pitch || s.headline || "a backend engineer";

function signature(s: Sender): string {
  return [s.my_name, s.headline, s.my_phone, s.my_linkedin && `LinkedIn: ${s.my_linkedin}`, s.resume_url && `Resume: ${s.resume_url}`]
    .filter(Boolean)
    .join("\n");
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

/** First messages, one per channel. `followUp` > 0 writes the n-th follow-up instead. */
export function messagesFor(s: Sender, r: Recipient, followUp = 0): Message[] {
  const leader = r.kind === "leader";
  const agency = r.kind === "consultant";
  const wantFor = agency ? `${role(s)} roles you are hiring for` : `${role(s)} roles${at(r)}`;

  if (followUp > 0) {
    const nudge = `${hi(r)}, following up on my earlier message about ${wantFor}. I'm ${pitch(s)}. Is there an opening that fits, or someone I should reach out to? Happy to share my resume. Thank you!`;
    return [
      { channel: "linkedin", label: "LinkedIn follow-up", body: nudge },
      {
        channel: "email",
        label: "Follow-up e-mail",
        subject: `Following up: ${s.target_role || "Backend Engineer"} application${r.company ? `, ${r.company}` : ""}`,
        body: `${hi(r)},\n\nFollowing up on my earlier e-mail about ${wantFor}. I'm ${pitch(s)}, and I'd be glad to talk whenever suits you. My resume is attached${s.resume_url ? " (also here: " + s.resume_url + ")" : ""}.\n\nThank you,\n${signature(s)}`,
      },
      { channel: "whatsapp", label: "WhatsApp follow-up", body: nudge },
    ];
  }

  const invite = leader
    ? `${hi(r)}, I'm ${me(s)}, ${pitch(s)}. I'm keen on ${r.company ?? "your company"} and would value connecting, and hearing if your team has roles where my background fits.`
    : `${hi(r)}, I'm ${me(s)}, ${pitch(s)}. I'm looking for ${wantFor} and would love to connect.`;
  const intro = leader
    ? `${hi(r)}, thank you for connecting. I'm ${pitch(s)}. I've been following ${r.company ?? "your company"} and would love to contribute to your team. If there is a role that fits, or someone you'd suggest I speak with, I'd be grateful. I can share my resume.`
    : `${hi(r)}, thank you for connecting. I'm ${pitch(s)}, looking for ${wantFor}. Is there an opening that fits my background? I'd be happy to share my resume.`;
  return [
    { channel: "linkedin", label: "LinkedIn invite note", body: clip(invite, 300), limit: 300 },
    { channel: "linkedin", label: "LinkedIn message (after they accept, or InMail)", body: intro },
    {
      channel: "email",
      label: "Cold e-mail",
      subject: `${s.target_role || "Backend Engineer"}${s.headline ? ` | ${s.headline}` : ""}${r.company ? ` | interested in ${r.company}` : ""}`,
      body: `${hi(r)},\n\nI'm ${me(s)}, ${pitch(s)}. I'm reaching out about ${wantFor}.\n\n${
        leader
          ? `I'd value a short conversation about your team's work and whether my background could help.`
          : `Could you let me know if there is a current opening that fits, or the right person to speak with?`
      } My resume is attached${s.resume_url ? " (also here: " + s.resume_url + ")" : ""}.\n\nThank you for your time,\n${signature(s)}`,
    },
    {
      channel: "whatsapp",
      label: "WhatsApp message",
      body: `${hi(r)}, I'm ${me(s)}, ${pitch(s)}. I'm looking for ${wantFor}. Could you let me know if there is an opening that fits my profile? I can share my resume here. Thank you!`,
    },
    {
      channel: "call",
      label: "Call notes",
      body: [
        `Introduce yourself: ${me(s)}, ${pitch(s)}.`,
        `Ask about ${wantFor}, and who handles them if it isn't them.`,
        "If they ask when you can interview: offer a face-to-face round first and say you can come to the office. " +
          "Offer virtual only if they prefer it; recruiters sometimes deprioritise candidates who ask for virtual.",
        "Confirm their e-mail and send your resume right after the call.",
      ].join("\n"),
    },
  ];
}

// ---- links that open each channel with the message in place -------------------------------------------------
export function whatsappLink(number: string, text: string): string {
  return `https://wa.me/${number.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

export function mailtoLink(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function telLink(number: string): string {
  return `tel:${number.replace(/[^\d+]/g, "")}`;
}

/** Their profile when you have it, else a LinkedIn people search for their name at the company. */
export function linkedinLink(url: string | null, name: string | null, company: string | null): string {
  if (url) return /^https?:/.test(url) ? url : `https://${url}`;
  const q = [name, company].filter(Boolean).join(" ");
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
}

/** People search at a company for the seniority levels worth reaching (Director, VP, Manager). */
export function leaderSearchLinks(company: string, companyUrl: string | null): { label: string; url: string }[] {
  const slug = companyUrl?.match(/linkedin\.com\/company\/([^/?#]+)/)?.[1];
  return ["Director", "VP", "Manager"].map((level) => ({
    label: `${level}s`,
    url: slug
      ? `https://www.linkedin.com/company/${slug}/people/?keywords=${encodeURIComponent(level)}`
      : `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${level} ${company}`)}`,
  }));
}
