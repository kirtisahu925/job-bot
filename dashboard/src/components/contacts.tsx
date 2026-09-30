import { Mail, MessageCircle, Network, Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { contactsApi } from "../lib/contacts/api";
import { CHANNEL_LABEL, STATUS_LABEL, type Channel, type ContactStatus } from "../lib/contacts/cadence";
import { displayName, type Contact } from "../lib/contacts/model";
import { companyKey } from "../lib/contacts/useContacts";
import { ICON } from "./bits";

const CHANNEL_ICON = { linkedin: Network, email: Mail, whatsapp: MessageCircle, call: Phone } as const;

export function ChannelIcon({ channel, size = 14 }: { channel: Channel; size?: number }) {
  const Icon = CHANNEL_ICON[channel];
  return <Icon {...ICON} size={size} aria-label={CHANNEL_LABEL[channel]} aria-hidden={false} role="img" />;
}

/** The channels a contact can be reached on, dimmed when missing. */
export function ChannelDots({ have }: { have: Channel[] }) {
  return (
    <span className="channel-dots">
      {(["linkedin", "email", "whatsapp", "call"] as Channel[]).map((ch) => (
        <span key={ch} className={have.includes(ch) ? "on" : "off"} title={`${CHANNEL_LABEL[ch]}${have.includes(ch) ? "" : ": no details"}`}>
          <ChannelIcon channel={ch} size={13} />
        </span>
      ))}
    </span>
  );
}

const STATUS_TONE: Record<ContactStatus, string> = {
  new: "",
  reaching_out: "info",
  in_touch: "good",
  interviewing: "good strong",
  closed: "muted",
  do_not_contact: "bad",
};

export function ContactStatusPill({ status }: { status: ContactStatus }) {
  return <span className={`pill cstatus ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

/** "overdue 3d" in warning ink, "today" in the accent, later dates muted. */
export function DueTag({ label }: { label: string }) {
  if (!label) return null;
  const tone = label.startsWith("overdue") ? "overdue" : label === "today" ? "today" : "later";
  return <span className={`due ${tone}`}>{label}</span>;
}

/** On a job's page: your contacts at that company, so you can reach HR straight from the job. Renders nothing
 * for accounts without the Contacts add-on. */
export function PeopleAtCompany({ company }: { company: string }) {
  const [people, setPeople] = useState<Contact[] | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      if (!(await contactsApi.features()).includes("contacts")) return;
      const [companies, contacts] = await Promise.all([contactsApi.companies(), contactsApi.contacts()]);
      const ids = new Set(companies.filter((c) => companyKey(c.name) === companyKey(company)).map((c) => c.id));
      if (live) setPeople(contacts.filter((c) => c.company_id && ids.has(c.company_id)));
    })().catch(() => live && setPeople(null));
    return () => {
      live = false;
    };
  }, [company]);
  if (!people) return null;
  return (
    <section className="panel panel-pad" aria-labelledby="people-h">
      <h2 id="people-h">People at {company}</h2>
      {people.length ? (
        <ul className="people">
          {people.map((p) => (
            <li key={p.id}>
              <Link to={`/contacts/${p.id}`}>{displayName(p, company)}</Link>
              <ContactStatusPill status={p.status} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="small soft">
          No contacts here yet. <Link to={`/contacts/import?company=${encodeURIComponent(company)}#add`}>Add one</Link>, or find HR on
          LinkedIn.
        </p>
      )}
    </section>
  );
}
