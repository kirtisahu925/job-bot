// Contacts data: your companies, contacts and every follow-up, in your own account (Supabase RLS: owner =
// you, and only while your account holds the Contacts add-on). Demo mode keeps a sample set in memory.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../api";
import { statusAfter, type Channel, type TouchOutcome } from "./cadence";
import type { Company, Contact, NewContact, OutreachSettings, Touch } from "./model";

export interface ContactsApi {
  /** Add-ons this account holds, e.g. ["contacts"]. */
  features(): Promise<string[]>;
  companies(): Promise<Company[]>;
  contacts(): Promise<Contact[]>;
  touches(): Promise<Touch[]>;
  /** Record a message, call or reply, and move the contact's status along. Returns the saved touch. */
  logTouch(contact: Contact, t: { channel: Channel; outcome: TouchOutcome; note?: string | null }): Promise<Touch>;
  updateContact(id: string, patch: Partial<Omit<Contact, "id" | "created_at" | "updated_at">>): Promise<void>;
  deleteContact(id: string): Promise<void>;
  /** Add contacts, creating their companies by name. Returns how many were added. */
  addContacts(list: NewContact[]): Promise<number>;
  updateCompany(id: string, patch: Partial<Omit<Company, "id">>): Promise<void>;
  addCompany(name: string, patch?: Partial<Omit<Company, "id" | "name">>): Promise<Company>;
  settings(): Promise<OutreachSettings | null>;
  saveSettings(s: OutreachSettings): Promise<void>;
}

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

const CONTACT_COLUMNS =
  "id,company_id,name,role,kind,location,phones,emails,linkedin_url,status,notes,source,labels,created_at,updated_at";

function supabaseContacts(client: SupabaseClient): ContactsApi {
  async function companyIds(names: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(names.filter(Boolean))];
    if (!unique.length) return new Map();
    must(await client.from("contact_companies").upsert(unique.map((name) => ({ name })), { onConflict: "owner,name", ignoreDuplicates: true }));
    const rows = must(await client.from("contact_companies").select("id,name").in("name", unique)) as { id: string; name: string }[];
    return new Map(rows.map((r) => [r.name, r.id]));
  }
  return {
    async features() {
      const rows = must(await client.from("feature_grants").select("feature")) as { feature: string }[];
      return rows.map((r) => r.feature);
    },
    async companies() {
      return must(await client.from("contact_companies").select("id,name,linkedin_url,website,target,notes").order("name")) as Company[];
    },
    async contacts() {
      return must(await client.from("contacts").select(CONTACT_COLUMNS).order("updated_at", { ascending: false }).limit(5000)) as Contact[];
    },
    async touches() {
      return must(await client.from("contact_touches").select("id,contact_id,channel,outcome,note,at").order("at").limit(20000)) as Touch[];
    },
    async logTouch(contact, t) {
      const touch = must(
        await client
          .from("contact_touches")
          .insert({ contact_id: contact.id, channel: t.channel, outcome: t.outcome, note: t.note ?? null })
          .select("id,contact_id,channel,outcome,note,at")
          .single(),
      ) as Touch;
      const status = statusAfter(contact.status, t.outcome);
      if (status !== contact.status) must(await client.from("contacts").update({ status }).eq("id", contact.id));
      return touch;
    },
    async updateContact(id, patch) {
      must(await client.from("contacts").update(patch).eq("id", id));
    },
    async deleteContact(id) {
      must(await client.from("contacts").delete().eq("id", id));
    },
    async addContacts(list) {
      if (!list.length) return 0;
      const ids = await companyIds(list.map((c) => c.company ?? ""));
      const rows = list.map(({ company, ...c }) => ({ ...c, company_id: company ? ids.get(company) ?? null : null }));
      const added = must(await client.from("contacts").insert(rows).select("id")) as { id: string }[];
      return added.length;
    },
    async updateCompany(id, patch) {
      must(await client.from("contact_companies").update(patch).eq("id", id));
    },
    async addCompany(name, patch = {}) {
      return must(
        await client
          .from("contact_companies")
          .upsert({ name, ...patch }, { onConflict: "owner,name" })
          .select("id,name,linkedin_url,website,target,notes")
          .single(),
      ) as Company;
    },
    async settings() {
      return must(await client.from("outreach_settings").select("*").maybeSingle()) as OutreachSettings | null;
    },
    async saveSettings(s) {
      must(await client.from("outreach_settings").upsert(s, { onConflict: "owner" }));
    },
  };
}

// ---- demo ---------------------------------------------------------------------------------------------------
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const phone = (n: string) => ({ number: n, whatsapp: true });

function demoContacts(): ContactsApi {
  const companies: Company[] = [
    { id: "c-qualys", name: "Qualys", linkedin_url: "https://www.linkedin.com/company/qualys/", website: "https://www.qualys.com", target: true,
      notes: "Target company: reach people at Director, VP and Manager level from the company page." },
    { id: "c-acme", name: "Acme Fintech", linkedin_url: null, website: null, target: false, notes: null },
    { id: "c-ledgerly", name: "Ledgerly", linkedin_url: null, website: null, target: false, notes: null },
    { id: "c-stackfold", name: "Stackfold", linkedin_url: null, website: null, target: false, notes: null },
    { id: "c-hire", name: "Hireline Consulting", linkedin_url: null, website: null, target: false, notes: null },
  ];
  const base = { location: null, linkedin_url: null, notes: null, source: "Demo", labels: [], created_at: iso(14), updated_at: iso(1) };
  let contacts: Contact[] = [
    { ...base, id: "p-1", company_id: "c-acme", name: "Riya Sharma", role: "HR", kind: "hr", phones: [phone("+919800000001")], emails: ["riya@acme.example"], status: "reaching_out" },
    { ...base, id: "p-2", company_id: "c-acme", name: null, role: "HR", kind: "hr", phones: [phone("+919800000002")], emails: [], status: "new" },
    { ...base, id: "p-3", company_id: "c-ledgerly", name: "Arjun Mehta", role: "Recruiter", kind: "recruiter", phones: [phone("+919800000003")], emails: [], status: "in_touch" },
    { ...base, id: "p-4", company_id: "c-stackfold", name: "Neha Gupta", role: "HR", kind: "hr", phones: [], emails: ["neha@stackfold.example"], status: "new" },
    { ...base, id: "p-5", company_id: "c-hire", name: "Kabir Rao", role: "Consultant", kind: "consultant", phones: [phone("+919800000005")], emails: [], status: "interviewing",
      notes: "Hiring for a Java platform team." },
    { ...base, id: "p-6", company_id: "c-qualys", name: "Meera Iyer", role: "Engineering Manager", kind: "leader", phones: [], emails: [],
      linkedin_url: "https://www.linkedin.com/in/example", status: "new" },
    { ...base, id: "p-7", company_id: null, name: "Sana", role: "HR", kind: "hr", phones: [phone("+919800000007")], emails: [], status: "new",
      notes: "Company not named when the number was shared" },
  ];
  let touches: Touch[] = [
    { id: "t-1", contact_id: "p-1", channel: "linkedin", outcome: "invite_sent", note: null, at: iso(4) },
    { id: "t-2", contact_id: "p-3", channel: "linkedin", outcome: "invite_sent", note: null, at: iso(6) },
    { id: "t-3", contact_id: "p-3", channel: "linkedin", outcome: "accepted", note: null, at: iso(5) },
    { id: "t-4", contact_id: "p-3", channel: "linkedin", outcome: "sent", note: null, at: iso(5) },
    { id: "t-5", contact_id: "p-3", channel: "linkedin", outcome: "replied", note: "Asked for my resume", at: iso(3) },
    { id: "t-6", contact_id: "p-3", channel: "email", outcome: "sent", note: "Sent resume", at: iso(3) },
    { id: "t-7", contact_id: "p-5", channel: "call", outcome: "interview", note: "Face-to-face round on Monday", at: iso(1) },
  ];
  let settings: OutreachSettings = {
    my_name: "Demo Candidate", my_email: "demo@example.com", my_phone: "+91 90000 00000", my_linkedin: "https://www.linkedin.com/in/demo",
    headline: "Backend Software Engineer", pitch: "a backend engineer with 2 years building Java and Spring Boot services",
    target_role: "Backend Engineer (Java)", resume_url: null, cadence_days: 2,
  };
  let seq = 100;
  return {
    async features() {
      return ["contacts"];
    },
    async companies() {
      return companies.map((c) => ({ ...c }));
    },
    async contacts() {
      return contacts.map((c) => ({ ...c }));
    },
    async touches() {
      return touches.map((t) => ({ ...t }));
    },
    async logTouch(contact, t) {
      const touch: Touch = { id: `t-${++seq}`, contact_id: contact.id, channel: t.channel, outcome: t.outcome, note: t.note ?? null, at: new Date().toISOString() };
      touches = [...touches, touch];
      contacts = contacts.map((c) => (c.id === contact.id ? { ...c, status: statusAfter(c.status, t.outcome), updated_at: touch.at } : c));
      return touch;
    },
    async updateContact(id, patch) {
      contacts = contacts.map((c) => (c.id === id ? { ...c, ...patch, updated_at: new Date().toISOString() } : c));
    },
    async deleteContact(id) {
      contacts = contacts.filter((c) => c.id !== id);
      touches = touches.filter((t) => t.contact_id !== id);
    },
    async addContacts(list) {
      for (const { company, ...c } of list) {
        let co = company ? companies.find((x) => x.name === company) : undefined;
        if (company && !co) {
          co = { id: `c-${++seq}`, name: company, linkedin_url: null, website: null, target: false, notes: null };
          companies.push(co);
        }
        contacts.push({ ...c, id: `p-${++seq}`, company_id: co?.id ?? null, status: c.status ?? "new", created_at: iso(0), updated_at: iso(0) });
      }
      return list.length;
    },
    async updateCompany(id, patch) {
      const i = companies.findIndex((c) => c.id === id);
      if (i >= 0) companies[i] = { ...companies[i], ...patch };
    },
    async addCompany(name, patch = {}) {
      let co = companies.find((c) => c.name === name);
      if (!co) {
        co = { id: `c-${++seq}`, name, linkedin_url: null, website: null, target: false, notes: null, ...patch };
        companies.push(co);
      }
      return { ...co };
    },
    async settings() {
      return { ...settings };
    },
    async saveSettings(s) {
      settings = { ...s };
    },
  };
}

export const contactsApi: ContactsApi = supabase ? supabaseContacts(supabase) : demoContacts();
