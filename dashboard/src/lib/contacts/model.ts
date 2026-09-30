import type { Channel, ContactStatus, TouchOutcome } from "./cadence";
import type { ContactKind, Phone } from "./parse";

export interface Company {
  id: string;
  name: string;
  linkedin_url: string | null;
  website: string | null;
  target: boolean;
  notes: string | null;
}

export interface Contact {
  id: string;
  company_id: string | null;
  name: string | null;
  role: string;
  kind: ContactKind;
  location: string | null;
  phones: Phone[];
  emails: string[];
  linkedin_url: string | null;
  status: ContactStatus;
  notes: string | null;
  source: string | null;
  labels: string[];
  created_at: string;
  updated_at: string;
}

export interface Touch {
  id: string;
  contact_id: string;
  channel: Channel;
  outcome: TouchOutcome;
  note: string | null;
  at: string;
}

export interface OutreachSettings {
  my_name: string | null;
  my_email: string | null;
  my_phone: string | null;
  my_linkedin: string | null;
  headline: string | null;
  pitch: string | null;
  target_role: string | null;
  resume_url: string | null;
  cadence_days: number;
}

export type NewContact = Omit<Contact, "id" | "created_at" | "updated_at" | "company_id" | "status"> & {
  company: string | null;
  status?: ContactStatus;
};

export const KIND_LABEL: Record<ContactKind, string> = {
  hr: "HR",
  recruiter: "Recruiter",
  consultant: "Consultant",
  leader: "Leader",
};

/** Display name: the person, else their role at the company, else the number. */
export function displayName(c: Pick<Contact, "name" | "role" | "phones" | "emails">, company?: string | null): string {
  if (c.name) return c.name;
  if (company) return `${c.role} at ${company}`;
  return c.phones[0]?.number ?? c.emails[0] ?? "Unnamed contact";
}
