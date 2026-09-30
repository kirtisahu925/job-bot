import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ICON, Notice } from "../components/bits";
import { contactsApi } from "../lib/contacts/api";
import { KIND_LABEL, type NewContact } from "../lib/contacts/model";
import { formatPhone, normalizePhone, parseContacts, type ContactKind, type ParsedContact } from "../lib/contacts/parse";
import { useContacts } from "../lib/contacts/useContacts";
import { useTitle } from "../lib/useTitle";

const today = () => new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function toNew(p: ParsedContact, source: string): NewContact {
  return {
    name: p.name,
    company: p.company,
    role: p.role,
    kind: p.kind,
    location: p.location,
    phones: p.phones,
    emails: p.emails,
    linkedin_url: null,
    notes: p.notes.join("\n") || null,
    source,
    labels: p.labels,
  };
}

export default function ContactsImport() {
  useTitle("Import contacts");
  const navigate = useNavigate();
  const location = useLocation();
  const { data, reload } = useContacts();
  const [text, setText] = useState("");
  const [source, setSource] = useState(`Pasted on ${today()}`);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const presetCompany = new URLSearchParams(location.search).get("company") ?? "";
  const [one, setOne] = useState({ name: "", company: presetCompany, role: "HR", kind: "hr" as ContactKind, phone: "", email: "", linkedin: "" });

  useEffect(() => {
    if (location.hash === "#add") document.getElementById("add")?.scrollIntoView();
  }, [location.hash]);

  const known = useMemo(() => {
    const phones = new Set<string>();
    const emails = new Set<string>();
    for (const c of data?.contacts ?? []) {
      c.phones.forEach((p) => phones.add(p.number));
      c.emails.forEach((e) => emails.add(e));
    }
    return { phones, emails };
  }, [data]);

  const parsed = useMemo(() => (text.trim() ? parseContacts(text) : null), [text]);
  const isDuplicate = (p: ParsedContact) => p.phones.some((x) => known.phones.has(x.number)) || p.emails.some((e) => known.emails.has(e));
  const fresh = parsed?.contacts.filter((p) => !isDuplicate(p)) ?? [];

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/contacts">Contacts</Link>
        <ChevronRight {...ICON} size={14} />
        <span>Import</span>
      </nav>
      <div className="page-head">
        <div>
          <h1>Import contacts</h1>
          <p className="lede">
            Paste a WhatsApp chat export, vCards, a list of names and numbers, or e-mail addresses. They are cleaned, grouped by company
            and checked against the contacts you already have.
          </p>
        </div>
      </div>
      {message && (
        <Notice kind={message.kind} onClose={() => setMessage(null)}>
          {message.text}
        </Notice>
      )}

      <section className="panel panel-pad stack" aria-labelledby="paste-h">
        <h2 id="paste-h">Paste</h2>
        <textarea
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Asha Acme HR\n+91 98000 00001\nRavi Globex Recruiter\n+91 98000 00002\nMeera Iyer <meera@example.com>, hr@example.org"}
          aria-label="Contacts to import"
        />
        <label className="field">
          Where they came from
          <input value={source} onChange={(e) => setSource(e.target.value)} />
        </label>
        {parsed && (
          <>
            <p className="small">
              <strong>{parsed.contacts.length}</strong> contacts found
              {parsed.contacts.length - fresh.length > 0 && <>, {parsed.contacts.length - fresh.length} already in your list (skipped)</>}
              {parsed.skipped.length > 0 && <>, {parsed.skipped.length} lines left out</>}.
            </p>
            <div className="table-wrap preview">
              <table className="entries">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Reach them on</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.contacts.map((p, i) => (
                    <tr key={i} className={isDuplicate(p) ? "dim" : undefined}>
                      <td>{p.company ?? <span className="muted">Not named</span>}</td>
                      <td>{p.name ?? <span className="muted">–</span>}</td>
                      <td>{p.role}</td>
                      <td className="small">
                        {[...p.phones.map((x) => formatPhone(x.number) + (x.whatsapp ? "" : " (landline)")), ...p.emails].join(", ")}
                        {isDuplicate(p) && <span className="muted xs"> already saved</span>}
                      </td>
                      <td className="small soft">{p.notes.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!!parsed.skipped.length && (
              <details>
                <summary className="small">Left out ({parsed.skipped.length})</summary>
                <ul className="small soft">
                  {parsed.skipped.map((s, i) => (
                    <li key={i}>
                      {s.value}: {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="row">
              <button
                className="btn primary"
                disabled={busy || !fresh.length}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const n = await contactsApi.addContacts(fresh.map((p) => toNew(p, source)));
                    setText("");
                    await reload();
                    setMessage({ kind: "ok", text: `Added ${n} contact${n === 1 ? "" : "s"}. They are due for a first message in Contacts.` });
                  } catch (err) {
                    setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Adding…" : `Add ${fresh.length} contact${fresh.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="panel panel-pad stack" id="add" aria-labelledby="add-h" style={{ marginTop: 16 }}>
        <h2 id="add-h">Add one contact</h2>
        <form
          className="stack form"
          onSubmit={async (e) => {
            e.preventDefault();
            const phone = one.phone.trim() ? normalizePhone(one.phone) : null;
            if (one.phone.trim() && !phone) {
              setMessage({ kind: "error", text: "That is not a phone number. Use +91 98765 43210 or 9876543210." });
              return;
            }
            try {
              await contactsApi.addContacts([
                {
                  name: one.name.trim() || null,
                  company: one.company.trim() || null,
                  role: one.role.trim() || KIND_LABEL[one.kind],
                  kind: one.kind,
                  location: null,
                  phones: phone ? [phone] : [],
                  emails: one.email.trim() ? [one.email.trim().toLowerCase()] : [],
                  linkedin_url: one.linkedin.trim() || null,
                  notes: null,
                  source: `Added by hand on ${today()}`,
                  labels: [],
                },
              ]);
              await reload();
              navigate("/contacts");
            } catch (err) {
              setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
            }
          }}
        >
          <div className="two">
            <label>
              Name
              <input value={one.name} onChange={(e) => setOne({ ...one, name: e.target.value })} placeholder="e.g. Asha Rao" />
            </label>
            <label>
              Company
              <input value={one.company} onChange={(e) => setOne({ ...one, company: e.target.value })} placeholder="e.g. Qualys" />
            </label>
          </div>
          <div className="two">
            <label>
              Role
              <input value={one.role} onChange={(e) => setOne({ ...one, role: e.target.value })} placeholder="HR, Engineering Manager, VP…" />
            </label>
            <label>
              Kind
              <select value={one.kind} onChange={(e) => setOne({ ...one, kind: e.target.value as ContactKind })}>
                {Object.entries(KIND_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="two">
            <label>
              Phone
              <input value={one.phone} onChange={(e) => setOne({ ...one, phone: e.target.value })} placeholder="+91 98765 43210" />
            </label>
            <label>
              E-mail
              <input type="email" value={one.email} onChange={(e) => setOne({ ...one, email: e.target.value })} />
            </label>
          </div>
          <label>
            LinkedIn profile
            <input value={one.linkedin} onChange={(e) => setOne({ ...one, linkedin: e.target.value })} placeholder="linkedin.com/in/…" />
          </label>
          <div className="row">
            <button className="btn primary" type="submit" disabled={!one.name.trim() && !one.phone.trim() && !one.email.trim() && !one.linkedin.trim()}>
              Add contact
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
