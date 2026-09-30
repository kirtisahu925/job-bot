// Turns pasted contact dumps into clean contacts: WhatsApp chat exports with vCards, "Name / number" lists
// copied from a phone, and e-mail lists ("Name <a@b.com>, c@d.com"). Numbers are normalised to +<country><number>,
// company spellings are unified, and entries that share a number, an e-mail or a full name are merged.

import { COMPANY_ALIASES, DOMAIN_COMPANIES, HANDLE_COMPANIES, LOCATIONS, type CompanyAlias } from "./companies";

export type ContactKind = "hr" | "recruiter" | "consultant" | "leader";

export interface Phone {
  number: string; // +919876543210
  whatsapp: boolean; // a mobile number (landlines cannot take WhatsApp messages)
}

export interface ParsedContact {
  name: string | null; // the person, when the label names one
  company: string | null;
  kind: ContactKind;
  role: string; // as shown: "HR", "Recruiter", "Consultant", "Talent Acquisition"
  location: string | null;
  phones: Phone[];
  emails: string[];
  notes: string[];
  labels: string[]; // every label this contact arrived under, for your reference
  agency: boolean;
}

export interface Skipped {
  value: string;
  reason: string;
}

export interface ParseResult {
  contacts: ParsedContact[];
  skipped: Skipped[];
}

const BIDI = /[‎‏‪-‮⁦-⁩]/g;
const PHONE_LINE = /^\+?\d[\d\s-]{6,}\d$/;
const EMAIL = /([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/;
const ADDRESS = /(?:("[^"]*"|[^,;<>"]*?)\s*<)?([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)>?/g;
const GENERIC_HANDLES = new Set(["hr", "info", "jobs", "recruit", "careers", "talent", "hiring", "goodvibes", "contact", "admin", "support"]);
const GENERIC_WORDS = new Set(["fintech", "healthcare", "product", "based", "team", "permanent", "wfh", "hello", "sir", "talent", "acquisition", "hiring",
  // corporate words are never part of a person's name
  "pvt", "ltd", "private", "limited", "inc", "llp", "technologies", "technology", "solutions", "software", "systems",
  "services", "consulting", "labs"]);
const ROLE_WORDS: Record<string, string> = { hr: "HR", recruiter: "Recruiter", consultant: "Consultant", intern: "HR intern" };

// ---- phones ------------------------------------------------------------------------------------------------
/** "+91 98765 43210", "98765 43210", "+918765432109" → "+919876543210". Landlines stay, marked not-WhatsApp. */
export function normalizePhone(raw: string, waid?: string): Phone | null {
  const text = raw.replace(BIDI, "").trim();
  const digits = text.replace(/\D/g, "");
  let number: string;
  if (text.startsWith("+")) number = `+${digits}`;
  else if (digits.length === 10) number = `+91${digits}`;
  else if (digits.length === 12 && digits.startsWith("91")) number = `+${digits}`;
  else if (digits.length === 11 && digits.startsWith("0")) number = `+91${digits.slice(1)}`;
  else return null;
  if (number.length < 11 || number.length > 16) return null;
  let whatsapp = true;
  if (number.startsWith("+91")) {
    const local = number.slice(3);
    if (local.length !== 10) return null;
    // Indian mobiles start 6-9; WhatsApp shows landlines as "+91 80 3533 8377" (area code, 4, 4)
    whatsapp = /^[6-9]/.test(local) && !/^\+91 \d{2} \d{4} \d{4}$/.test(text);
  }
  if (waid) whatsapp = true;
  return { number, whatsapp };
}

export function formatPhone(number: string): string {
  if (number.startsWith("+91") && number.length === 13) return `+91 ${number.slice(3, 8)} ${number.slice(8)}`;
  return number;
}

// ---- labels ---------------------------------------------------------------------------------------------------
const ALIAS_KEYS = Object.keys(COMPANY_ALIASES).sort((a, b) => b.length - a.length);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function titleCase(word: string): string {
  if (/[a-z]/.test(word) && /[A-Z]/.test(word.slice(1))) return word; // BharathK, McDonald: keep as written
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export interface LabelReading {
  name: string | null;
  company: CompanyAlias | null;
  kind: ContactKind;
  role: string;
  location: string | null;
  notes: string[];
}

/** "Fiserv Noida HR Shivangi" → Shivangi, Fiserv, HR, Noida. "Akansha JP Morgan Hr Neeraj Team" → Akansha,
 * JPMorgan Chase, note "Neeraj Team". */
export function readLabel(label: string): LabelReading {
  let text = label.replace(BIDI, "").replace(/\(HR\)/gi, " HR ").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  const notes: string[] = [];
  let company: CompanyAlias | null = null;
  // company: longest alias that appears as whole words
  for (const key of ALIAS_KEYS) {
    const re = new RegExp(`(^|[\\s(])${escapeRe(key)}(?=$|[\\s),.])`, "i");
    const m = text.match(re);
    if (m && m.index !== undefined) {
      company = COMPANY_ALIASES[key];
      text = `${text.slice(0, m.index)}${m[1]}\u0000${text.slice(m.index + m[0].length)}`;
      break;
    }
  }
  const tokens = text.split(/\s+/).filter(Boolean);
  let role = "HR";
  let kind: ContactKind = "hr";
  let location: string | null = null;
  const segments: string[][] = [[]];
  for (const token of tokens) {
    const low = token.toLowerCase().replace(/[.,]$/, "");
    if (token === "\u0000") {
      segments.push([]);
      continue;
    }
    if (low in ROLE_WORDS) {
      if (low === "recruiter") {
        role = "Recruiter";
        kind = "recruiter";
      } else if (low === "consultant") {
        role = "Consultant";
        kind = "consultant";
      }
      segments.push([]);
      continue;
    }
    if (low in LOCATIONS) {
      location = LOCATIONS[low];
      segments.push([]);
      continue;
    }
    if (low.startsWith("@")) {
      segments.push([]);
      continue;
    }
    if (/^hr\d+$/.test(low)) {
      notes.push(`Saved as "${token}"`);
      segments.push([]);
      continue;
    }
    segments[segments.length - 1].push(token);
  }
  const words = segments.filter((s) => s.length);
  const personal = words.filter((s) => !s.every((w) => GENERIC_WORDS.has(w.toLowerCase())));
  for (const s of words) if (!personal.includes(s)) notes.push(s.join(" "));
  const name = personal.length ? personal[0].map(titleCase).join(" ") : null;
  for (const s of personal.slice(1)) notes.push(s.join(" "));
  if (company?.agency && kind === "hr") {
    kind = "consultant";
    role = "Consultant";
  }
  return { name, company, kind, role, location, notes };
}

// ---- the parser --------------------------------------------------------------------------------------------
function blank(): ParsedContact {
  return { name: null, company: null, kind: "hr", role: "HR", location: null, phones: [], emails: [], notes: [], labels: [], agency: false };
}

function fromLabel(label: string): ParsedContact {
  const r = readLabel(label);
  const c = blank();
  c.name = r.name;
  c.company = r.company?.name ?? null;
  c.agency = !!r.company?.agency;
  c.kind = r.kind;
  c.role = r.role;
  c.location = r.location;
  c.notes = [...r.notes];
  if (r.company?.guess) c.notes.push(`Company read as ${r.company.name} from "${label.trim()}"; check it`);
  c.labels = [label.replace(BIDI, "").trim()];
  return c;
}

function addPhone(c: ParsedContact, p: Phone | null) {
  if (p && !c.phones.some((x) => x.number === p.number)) c.phones.push(p);
}

function personFromHandle(handle: string): string | null {
  const parts = handle.split(/[._-]+/).filter((p) => p && !/^\d+$/.test(p) && !(p.toLowerCase() in ROLE_WORDS));
  if (!parts.length || GENERIC_HANDLES.has(parts[0].toLowerCase())) return null;
  return parts.map((p) => titleCase(p.replace(/\d+$/, ""))).join(" ");
}

function fromEmail(email: string, display: string | null): ParsedContact | Skipped {
  const address = email.toLowerCase();
  const [handle, domain] = address.split("@");
  if (/(^|\.)reply\.linkedin\.com$/.test(domain) || handle.startsWith("inmail")) {
    if (display) {
      const c = blank();
      c.name = display;
      c.notes.push("Wrote to you through LinkedIn: reply in that LinkedIn conversation (the address only works as a reply)");
      c.labels = [display];
      return c;
    }
    return { value: email, reason: "LinkedIn's automatic reply address, not a person" };
  }
  if (/^(notifications?|no-?reply|mailer-daemon)$/.test(handle)) return { value: email, reason: "an automatic notification address" };
  const c = blank();
  c.emails = [address];
  c.labels = [display ? `${display} <${address}>` : address];
  const handleCo = HANDLE_COMPANIES[handle];
  const domainCo = DOMAIN_COMPANIES[domain];
  const co = handleCo ?? domainCo ?? null;
  if (co) {
    c.company = co.name;
    c.agency = !!co.agency;
    if (co.guess) c.notes.push(`Company read as ${co.name} from ${domain}; check it`);
  } else if (!/^(gmail|yahoo|outlook|hotmail)\./.test(domain)) {
    c.company = titleCase(domain.split(".")[0]);
  }
  const shown = display?.replace(/^"|"$/g, "").trim();
  if (shown && /,/.test(shown)) c.name = shown.split(",").reverse().map((s) => s.trim()).join(" "); // "Rao, Asha"
  else if (shown && !/recruiter|hr\b/i.test(shown)) c.name = shown;
  else c.name = handleCo ? (handleCo.person ?? null) : personFromHandle(handle);
  if (/recruit/i.test(handle + (shown ?? ""))) {
    c.kind = "recruiter";
    c.role = "Recruiter";
  }
  if (/intern/.test(handle)) c.role = "HR intern";
  if (c.agency) {
    c.kind = "consultant";
    c.role = "Consultant";
  }
  return c;
}

/** Everything in one pasted blob. */
export function parseContacts(input: string): ParseResult {
  const skipped: Skipped[] = [];
  const found: ParsedContact[] = [];
  let text = input.replace(/\r/g, "").replace(BIDI, "");

  // 1. vCards
  text = text.replace(/BEGIN:VCARD[\s\S]*?END:VCARD\]?/g, (card) => {
    const field = (name: string) => card.match(new RegExp(`^${name}(?:;[^:\\n]*)?:(.*)$`, "m"))?.[1]?.trim() ?? "";
    const label = field("FN") || field("X-WA-BIZ-NAME") || field("ORG");
    const c = label ? fromLabel(label) : blank();
    for (const m of card.matchAll(/^TEL([^:\n]*):(.+)$/gm)) addPhone(c, normalizePhone(m[2], m[1].match(/waid=(\d+)/)?.[1]));
    for (const m of card.matchAll(/^EMAIL[^:\n]*:(.+)$/gm)) c.emails.push(m[1].trim().toLowerCase());
    const title = field("TITLE");
    if (title) c.notes.push(title);
    if (c.phones.length || c.emails.length) found.push(c);
    else skipped.push({ value: label || "vCard", reason: "no number or e-mail" });
    return "\n";
  });

  // 2. chat furniture: "[17:01] **Name:** [Forwarded] ...", "[Name] x", "[Custom] +91..."
  const lines = text
    .split("\n")
    .map((l) =>
      l
        .replace(/^\[\d{1,2}:\d{2}\]\s*\*\*[^*]+:\*\*\s*/, "")
        .replace(/^\[Forwarded(?: many times)?\]\s*/, "")
        .replace(/^\[(Name|Custom|Mobile|Phone|Work)\]\s*/, "")
        .replace(/^\[Contact:\s*$/, "")
        .trim(),
    );

  // 3. contact-count placeholders WhatsApp could not export
  const groups = lines.filter((l) => /^\[\d+ contacts\]$/.test(l));
  for (const g of groups) skipped.push({ value: g, reason: "WhatsApp exported only the count; forward that card as .vcf to import it" });

  // 4. e-mails (with display names), then name / number runs
  let current: ParsedContact | null = null;
  let pending: string[] = [];
  const flushNotes = () => {
    if (current) for (const p of pending) if (!current.labels.includes(p) && !current.notes.includes(p)) current.notes.push(p);
    pending = [];
  };
  for (const raw of lines) {
    const line = raw.replace(/,$/, "").trim();
    if (!line || /^\[\d+ contacts\]$/.test(line) || /^#|^---$|^Export date/i.test(line)) {
      if (!line) flushNotes();
      continue;
    }
    if (EMAIL.test(line)) {
      flushNotes();
      // one or more addresses: "Name <a@b.com>, c@d.com", "\"Rao, Asha\" <e@f.com>"
      let rest = line;
      for (const m of line.matchAll(ADDRESS)) {
        const display = (m[1] ?? "").replace(/^[\s,;]+|[\s,;]+$/g, "").replace(/"/g, "").trim() || null;
        const c = fromEmail(m[2], display);
        rest = rest.replace(m[0], " ");
        if ("reason" in c) skipped.push(c);
        else {
          found.push(c);
          current = c;
        }
      }
      // a number on the same line belongs to the last address
      const trailing = rest.replace(/[<>,;]/g, " ").trim();
      if (current && trailing && PHONE_LINE.test(trailing)) addPhone(current, normalizePhone(trailing));
      continue;
    }
    if (PHONE_LINE.test(line)) {
      const phone = normalizePhone(line);
      if (!phone) {
        skipped.push({ value: line, reason: "not a recognisable phone number" });
        continue;
      }
      if (pending.length) {
        const label = pending.pop() as string;
        flushNotes();
        current = fromLabel(label);
        found.push(current);
      } else if (!current) {
        current = blank();
        found.push(current);
      }
      addPhone(current, phone);
      continue;
    }
    pending.push(line);
  }
  flushNotes();

  return { contacts: mergeContacts(found), skipped };
}

// ---- merging ----------------------------------------------------------------------------------------------
const nameKey = (n: string | null) => (n ?? "").toLowerCase().replace(/[^a-z]/g, "");

function mergeInto(a: ParsedContact, b: ParsedContact) {
  a.name = a.name ?? b.name;
  if (b.name && a.name && b.name.length > a.name.length && nameKey(b.name).startsWith(nameKey(a.name))) a.name = b.name;
  a.company = a.company ?? b.company;
  a.agency = a.agency || b.agency;
  a.location = a.location ?? b.location;
  if (a.kind === "hr" && b.kind !== "hr") {
    a.kind = b.kind;
    a.role = b.role;
  }
  for (const p of b.phones) addPhone(a, p);
  for (const e of b.emails) if (!a.emails.includes(e)) a.emails.push(e);
  for (const n of b.notes) if (!a.notes.includes(n)) a.notes.push(n);
  for (const l of b.labels) if (!a.labels.includes(l)) a.labels.push(l);
}

/** Short notes are often the person's own WhatsApp display name ("Asha_ LTIMindtree" under "L & T HR",
 * "Asha Rao" under "Asha HR"): use one to fill in a missing name, or to complete a first name. */
function adoptDisplayName(c: ParsedContact) {
  for (const note of c.notes) {
    if (note.length > 40 || note.split(/\s+/).length > 4 || /["]|^Saved as|^Company read/.test(note)) continue;
    const r = readLabel(note);
    if (!r.name) continue;
    if (!c.name) {
      c.name = r.name;
      if (r.company) c.company = r.company.name; // their own profile names the employer more precisely
    } else if (nameKey(r.name).startsWith(nameKey(c.name)) && r.name.length > c.name.length) {
      c.name = r.name;
    } else continue;
    c.notes = c.notes.filter((n) => n !== note);
    c.notes.push(`WhatsApp name: ${note}`);
    return;
  }
}

/** Same number or e-mail → one contact. Same full name at the same company (or one side without a company)
 * → one contact. Nameless contacts at the same company stay separate: they are different desks. */
export function mergeContacts(list: ParsedContact[]): ParsedContact[] {
  const out: ParsedContact[] = [];
  for (const c of list) {
    const match = out.find(
      (o) =>
        o.phones.some((p) => c.phones.some((q) => q.number === p.number)) ||
        o.emails.some((e) => c.emails.includes(e)) ||
        (!!o.name &&
          !!c.name &&
          nameKey(o.name) === nameKey(c.name) &&
          nameKey(o.name).length > 4 &&
          (o.company === c.company || !o.company || !c.company)),
    );
    if (match) mergeInto(match, c);
    else out.push({ ...c, phones: [...c.phones], emails: [...c.emails], notes: [...c.notes], labels: [...c.labels] });
  }
  for (const c of out) {
    adoptDisplayName(c);
    // a note that only repeats the person's name or the label adds nothing
    c.notes = c.notes.filter((n) => nameKey(n) !== nameKey(c.name) && !c.labels.includes(n));
  }
  return out.sort((a, b) => (a.company ?? "~").localeCompare(b.company ?? "~") || (a.name ?? "~").localeCompare(b.name ?? "~"));
}
