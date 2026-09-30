import { useCallback, useEffect, useMemo, useState } from "react";
import { contactsApi } from "./api";
import { nextStep, type NextStep } from "./cadence";
import type { Company, Contact, OutreachSettings, Touch } from "./model";

export interface Row {
  contact: Contact;
  company: Company | null;
  touches: Touch[]; // oldest first
  last: Touch | null;
  next: NextStep;
}

export interface ContactsData {
  companies: Company[];
  contacts: Contact[];
  touches: Touch[];
  settings: OutreachSettings | null;
}

/** Everything the Contacts pages need, with each contact's next step worked out. */
export function useContacts() {
  const [data, setData] = useState<ContactsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [companies, contacts, touches, settings] = await Promise.all([
        contactsApi.companies(),
        contactsApi.contacts(),
        contactsApi.touches(),
        contactsApi.settings(),
      ]);
      setData({ companies, contacts, touches, settings });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const now = new Date();
    const gap = data.settings?.cadence_days ?? 2;
    const byCompany = new Map(data.companies.map((c) => [c.id, c]));
    const byContact = new Map<string, Touch[]>();
    for (const t of data.touches) byContact.set(t.contact_id, [...(byContact.get(t.contact_id) ?? []), t]);
    return data.contacts.map((contact) => {
      const touches = (byContact.get(contact.id) ?? []).sort((a, b) => a.at.localeCompare(b.at));
      const company = contact.company_id ? byCompany.get(contact.company_id) ?? null : null;
      return {
        contact,
        company,
        touches,
        last: touches[touches.length - 1] ?? null,
        next: nextStep({ ...contact, company: company?.name }, touches, now, gap),
      };
    });
  }, [data]);

  return { data, rows, error, reload };
}

/** Lower-case letters and digits only: "Tata 1mg" and "TATA 1MG Pvt" compare equal enough for matching jobs. */
export function companyKey(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|inc|llp|technologies|technology|solutions|india)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}
