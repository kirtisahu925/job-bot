import { ChevronRight, Copy, ExternalLink, Star, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ICON, Notice } from "../components/bits";
import { ChannelIcon, ContactStatusPill, DueTag } from "../components/contacts";
import { ago } from "../lib/format";
import { contactsApi } from "../lib/contacts/api";
import {
  CHANNEL_LABEL,
  channelsFor,
  dueLabel,
  INBOUND,
  LADDER,
  OUTCOME_LABEL,
  STATUS_LABEL,
  type Channel,
  type ContactStatus,
  type TouchOutcome,
} from "../lib/contacts/cadence";
import { displayName, KIND_LABEL, type Contact } from "../lib/contacts/model";
import { formatPhone, normalizePhone, type ContactKind } from "../lib/contacts/parse";
import {
  leaderSearchLinks,
  linkedinLink,
  mailtoLink,
  messagesFor,
  telLink,
  whatsappLink,
  type Message,
  type Sender,
} from "../lib/contacts/templates";
import { useContacts } from "../lib/contacts/useContacts";
import { useTitle } from "../lib/useTitle";

/** What you can record after using each channel. */
const LOG_OPTIONS: Record<Channel, TouchOutcome[]> = {
  linkedin: ["invite_sent", "sent", "accepted", "replied", "not_interested"],
  email: ["sent", "replied", "not_interested"],
  whatsapp: ["sent", "replied", "not_interested"],
  call: ["no_answer", "call_scheduled", "interview", "replied", "not_interested"],
};

const EMPTY_SENDER: Sender = {
  my_name: null,
  my_email: null,
  my_phone: null,
  my_linkedin: null,
  headline: null,
  pitch: null,
  target_role: null,
  resume_url: null,
};

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <button
      type="button"
      className="btn small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone("ok");
        } catch {
          setDone("fail");
        }
        setTimeout(() => setDone("idle"), 1800);
      }}
    >
      <Copy {...ICON} size={14} />
      {done === "ok" ? "Copied" : done === "fail" ? "Select and copy" : "Copy"}
    </button>
  );
}

function Editor({ contact, companyName, onSaved }: { contact: Contact; companyName: string | null; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: contact.name ?? "",
    company: companyName ?? "",
    role: contact.role,
    kind: contact.kind,
    location: contact.location ?? "",
    phones: contact.phones.map((p) => p.number).join(", "),
    emails: contact.emails.join(", "),
    linkedin_url: contact.linkedin_url ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <form
      className="stack form"
      onSubmit={async (e) => {
        e.preventDefault();
        const phones = form.phones
          .split(/[,;\n]/)
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => normalizePhone(p));
        if (phones.some((p) => !p)) return setError("One of the numbers is not a phone number. Use +91 98765 43210 or 9876543210.");
        const company = form.company.trim() ? await contactsApi.addCompany(form.company.trim()) : null;
        await contactsApi.updateContact(contact.id, {
          name: form.name.trim() || null,
          company_id: company?.id ?? null,
          role: form.role.trim() || "HR",
          kind: form.kind,
          location: form.location.trim() || null,
          phones: phones.map((p) => p!),
          emails: form.emails.split(/[,;\s]+/).map((m) => m.trim().toLowerCase()).filter(Boolean),
          linkedin_url: form.linkedin_url.trim() || null,
        });
        onSaved();
      }}
    >
      {error && <Notice kind="error">{error}</Notice>}
      <label>
        Name
        <input value={form.name} onChange={set("name")} placeholder="Their name, if you know it" />
      </label>
      <label>
        Company
        <input value={form.company} onChange={set("company")} />
      </label>
      <div className="two">
        <label>
          Role
          <input value={form.role} onChange={set("role")} />
        </label>
        <label>
          Kind
          <select value={form.kind} onChange={set("kind")}>
            {Object.entries(KIND_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Phone numbers
        <input value={form.phones} onChange={set("phones")} placeholder="+91 98765 43210, …" />
      </label>
      <label>
        E-mails
        <input value={form.emails} onChange={set("emails")} />
      </label>
      <label>
        LinkedIn profile
        <input value={form.linkedin_url} onChange={set("linkedin_url")} placeholder="linkedin.com/in/…" />
      </label>
      <label>
        Location
        <input value={form.location} onChange={set("location")} />
      </label>
      <div className="row">
        <button className="btn primary small" type="submit">
          Save
        </button>
      </div>
    </form>
  );
}

export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, rows, error, reload } = useContacts();
  const row = rows.find((r) => r.contact.id === id);
  const c = row?.contact;
  const company = row?.company ?? null;
  useTitle(c ? displayName(c, company?.name) : "Contact");

  const ways = useMemo(() => (c ? channelsFor({ ...c, company: company?.name }) : []), [c, company]);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);

  useEffect(() => {
    if (row && channel === null) setChannel(row.next.channel ?? ways[0] ?? "call");
  }, [row, channel, ways]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!data) return <p className="muted">Loading…</p>;
  if (!row || !c) {
    return (
      <div className="stack">
        <p>This contact does not exist or was deleted.</p>
        <Link to="/contacts">Back to Contacts</Link>
      </div>
    );
  }

  const sender: Sender = { ...EMPTY_SENDER, ...(data.settings ?? {}) };
  const outs = row.touches.filter((t) => !INBOUND.includes(t.outcome));
  const lastIn = [...row.touches].reverse().find((t) => INBOUND.includes(t.outcome));
  const followUp = outs.length > 0 && !lastIn ? outs.length : 0;
  const messages = messagesFor(sender, { name: c.name, company: company?.name ?? null, kind: c.kind }, followUp);
  const current = channel ?? row.next.channel ?? "call";
  const forChannel = messages.filter((m) => m.channel === current);
  const text = (m: Message) => drafts[m.label] ?? m.body;
  const waPhones = c.phones.filter((p) => p.whatsapp);
  const name = displayName(c, company?.name);

  const log = async (outcome: TouchOutcome) => {
    await contactsApi.logTouch(c, { channel: current, outcome, note: note.trim() || null });
    setNote("");
    setSaved(`${OUTCOME_LABEL[outcome]} on ${CHANNEL_LABEL[current]} recorded.`);
    setChannel(null); // jump to whatever the rule says next
    await reload();
  };

  const setStatus = async (status: ContactStatus) => {
    await contactsApi.updateContact(c.id, { status });
    await reload();
  };

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/contacts">Contacts</Link>
        <ChevronRight {...ICON} size={14} />
        <span>{company?.name ?? "Company not named"}</span>
      </nav>
      <div className="page-head">
        <div>
          <h1>
            {name}
            {company?.target && <Star {...ICON} size={16} className="icon star" aria-label="Target company" />}
          </h1>
          <p className="lede">{[c.name ? c.role : KIND_LABEL[c.kind], company?.name, c.location].filter(Boolean).join(" · ")}</p>
        </div>
        <label className="row" style={{ gap: 8 }}>
          <span className="muted small">Status</span>
          <select value={c.status} onChange={(e) => setStatus(e.target.value as ContactStatus)}>
            {Object.entries(STATUS_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {saved && (
        <Notice kind="ok" onClose={() => setSaved(null)}>
          {saved}
        </Notice>
      )}

      <div className="split">
        <div className="stack">
          <section className="panel panel-pad next-step" aria-labelledby="next-h">
            <div className="section-head">
              <h2 id="next-h">Next step</h2>
              <DueTag label={row.next.due ? dueLabel(row.next.due) : ""} />
            </div>
            <p className="next-action">
              {row.next.channel && <ChannelIcon channel={row.next.channel} size={16} />}
              <strong>{row.next.action}</strong>
            </p>
            <p className="muted small">{row.next.why}</p>
          </section>

          <section className="panel" aria-labelledby="send-h">
            <div className="panel-pad" style={{ paddingBottom: 0 }}>
              <h2 id="send-h">Reach out</h2>
              <div className="tabs channel-tabs" role="group" aria-label="Channel">
                {LADDER.map((ch) => (
                  <button key={ch} aria-pressed={current === ch} disabled={!ways.includes(ch)} onClick={() => setChannel(ch)}
                    title={ways.includes(ch) ? undefined : `No ${CHANNEL_LABEL[ch]} details for this contact`}>
                    <ChannelIcon channel={ch} />
                    {CHANNEL_LABEL[ch]}
                  </button>
                ))}
              </div>
            </div>
            <div className="panel-pad stack">
              {forChannel.map((m) => (
                <div key={m.label} className="message">
                  <div className="section-head" style={{ marginBottom: 6 }}>
                    <h3>{m.label}</h3>
                    {m.limit && (
                      <span className={`xs ${text(m).length > m.limit ? "bad" : "muted"}`}>
                        {text(m).length} / {m.limit}
                      </span>
                    )}
                  </div>
                  {m.subject && <p className="small"><span className="muted">Subject:</span> {m.subject}</p>}
                  {m.channel === "call" ? (
                    <ul className="call-notes">
                      {m.body.split("\n").map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    <textarea
                      value={text(m)}
                      rows={m.channel === "email" ? 9 : 4}
                      onChange={(e) => setDrafts({ ...drafts, [m.label]: e.target.value })}
                      aria-label={m.label}
                    />
                  )}
                  <div className="row" style={{ marginTop: 8 }}>
                    {m.channel === "linkedin" && (
                      <a className="btn small primary" href={linkedinLink(c.linkedin_url, c.name, company?.name ?? null)} target="_blank" rel="noreferrer">
                        <ExternalLink {...ICON} size={14} />
                        {c.linkedin_url ? "Open their profile" : "Find them on LinkedIn"}
                      </a>
                    )}
                    {m.channel === "email" &&
                      c.emails.map((to) => (
                        <a key={to} className="btn small primary" href={mailtoLink(to, m.subject ?? "", text(m))}>
                          <ExternalLink {...ICON} size={14} />
                          E-mail {to}
                        </a>
                      ))}
                    {m.channel === "whatsapp" &&
                      waPhones.map((p) => (
                        <a key={p.number} className="btn small primary" href={whatsappLink(p.number, text(m))} target="_blank" rel="noreferrer">
                          <ExternalLink {...ICON} size={14} />
                          WhatsApp {formatPhone(p.number)}
                        </a>
                      ))}
                    {m.channel === "call" &&
                      c.phones.map((p) => (
                        <a key={p.number} className="btn small primary" href={telLink(p.number)}>
                          Call {formatPhone(p.number)}
                        </a>
                      ))}
                    {m.channel !== "call" && <CopyButton text={m.subject ? `${m.subject}\n\n${text(m)}` : text(m)} />}
                  </div>
                </div>
              ))}
              <div className="log-box">
                <h3>Record what happened</h3>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional): what they said, when to call back" aria-label="Note" />
                <div className="row wrap" style={{ gap: 6 }}>
                  {LOG_OPTIONS[current].map((o) => (
                    <button key={o} className="btn small" onClick={() => log(o)}>
                      {OUTCOME_LABEL[o]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="panel panel-pad" aria-labelledby="history-h">
            <h2 id="history-h" style={{ marginBottom: 10 }}>
              History
            </h2>
            {row.touches.length ? (
              <ol className="timeline">
                {[...row.touches].reverse().map((t) => (
                  <li key={t.id}>
                    <ChannelIcon channel={t.channel} />
                    <span className={INBOUND.includes(t.outcome) ? "good" : undefined}>{OUTCOME_LABEL[t.outcome]}</span>
                    <span className="muted">on {CHANNEL_LABEL[t.channel]}</span>
                    <span className="muted xs">{ago(t.at)}</span>
                    {t.note && <span className="t-note">{t.note}</span>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted small">Nothing yet. Reach out above, then record it so the next follow-up is scheduled.</p>
            )}
          </section>
        </div>

        <aside className="props" aria-label="Contact details">
          <section className="panel panel-pad">
            {editing ? (
              <Editor
                contact={c}
                companyName={company?.name ?? null}
                onSaved={async () => {
                  setEditing(false);
                  await reload();
                }}
              />
            ) : (
              <>
                <dl className="prop-list">
                  <div className="prop">
                    <dt>Status</dt>
                    <dd>
                      <ContactStatusPill status={c.status} />
                    </dd>
                  </div>
                  <div className="prop">
                    <dt>Kind</dt>
                    <dd>{KIND_LABEL[c.kind as ContactKind]}</dd>
                  </div>
                  <div className="prop">
                    <dt>Phone</dt>
                    <dd className="prop-stack">
                      {c.phones.length
                        ? c.phones.map((p) => (
                            <a key={p.number} href={telLink(p.number)}>
                              {formatPhone(p.number)}
                              {!p.whatsapp && <span className="muted xs"> landline</span>}
                            </a>
                          ))
                        : <span className="muted">None</span>}
                    </dd>
                  </div>
                  <div className="prop">
                    <dt>E-mail</dt>
                    <dd className="prop-stack">
                      {c.emails.length ? c.emails.map((m) => <a key={m} href={`mailto:${m}`}>{m}</a>) : <span className="muted">None</span>}
                    </dd>
                  </div>
                  <div className="prop">
                    <dt>LinkedIn</dt>
                    <dd>
                      <a href={linkedinLink(c.linkedin_url, c.name, company?.name ?? null)} target="_blank" rel="noreferrer">
                        {c.linkedin_url ? "Profile" : c.name ? "Search" : "Search the company"}
                      </a>
                    </dd>
                  </div>
                  {c.source && (
                    <div className="prop">
                      <dt>Source</dt>
                      <dd className="soft small">{c.source}</dd>
                    </div>
                  )}
                  {!!c.labels.length && (
                    <div className="prop">
                      <dt>Saved as</dt>
                      <dd className="soft small">{c.labels.join(" · ")}</dd>
                    </div>
                  )}
                </dl>
                <button className="btn small" onClick={() => setEditing(true)}>
                  Edit details
                </button>
              </>
            )}
          </section>

          <section className="panel panel-pad tip" aria-labelledby="tip-h">
            <h2 id="tip-h">When they call</h2>
            <p className="small soft">
              If HR asks when you can interview, say yes to a face-to-face round and let them schedule it around you. Asking for virtual
              can get you deprioritised.
            </p>
          </section>

          {company?.target && (
            <section className="panel panel-pad" aria-labelledby="leaders-h">
              <h2 id="leaders-h">Leaders at {company.name}</h2>
              <p className="small soft">Send an invite saying you are interested in {company.name}, and ask about relevant roles.</p>
              <div className="row" style={{ gap: 12 }}>
                {leaderSearchLinks(company.name, company.linkedin_url).map((l) => (
                  <a key={l.label} href={l.url} target="_blank" rel="noreferrer">
                    {l.label}
                  </a>
                ))}
              </div>
            </section>
          )}

          <section className="panel panel-pad" aria-labelledby="notes-h">
            <h2 id="notes-h">Notes</h2>
            <textarea rows={5} value={notes ?? c.notes ?? ""} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
            <div className="row">
              <button
                className="btn small"
                disabled={notes === null || notes === (c.notes ?? "")}
                onClick={async () => {
                  await contactsApi.updateContact(c.id, { notes: notes?.trim() || null });
                  setNotes(null);
                  await reload();
                }}
              >
                Save notes
              </button>
              {confirmDelete ? (
                <button
                  className="btn small danger"
                  onClick={async () => {
                    await contactsApi.deleteContact(c.id);
                    navigate("/contacts");
                  }}
                >
                  Delete for good
                </button>
              ) : (
                <button className="btn small quiet" onClick={() => setConfirmDelete(true)} aria-label="Delete contact">
                  <Trash2 {...ICON} size={14} />
                  Delete
                </button>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
