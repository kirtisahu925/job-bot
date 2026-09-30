import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ICON, Notice } from "../components/bits";
import { contactsApi } from "../lib/contacts/api";
import type { OutreachSettings } from "../lib/contacts/model";
import { useTitle } from "../lib/useTitle";

const BLANK: OutreachSettings = {
  my_name: null,
  my_email: null,
  my_phone: null,
  my_linkedin: null,
  headline: null,
  pitch: null,
  target_role: null,
  resume_url: null,
  cadence_days: 2,
};

const FIELDS: { key: keyof OutreachSettings; label: string; hint?: string }[] = [
  { key: "my_name", label: "Your name" },
  { key: "headline", label: "Headline", hint: "Shown under your name in e-mails, e.g. Backend Software Engineer" },
  { key: "pitch", label: "One-line pitch", hint: "Used in every message after \"I'm\", e.g. a backend engineer with 2.4 years building Java and Spring Boot services" },
  { key: "target_role", label: "Roles you want", hint: "e.g. Backend Engineer (Java)" },
  { key: "my_email", label: "Your e-mail" },
  { key: "my_phone", label: "Your phone" },
  { key: "my_linkedin", label: "Your LinkedIn" },
  { key: "resume_url", label: "Resume link (optional)", hint: "A shareable link; otherwise attach the tailored PDF yourself" },
];

export default function ContactsSettings() {
  useTitle("Your details for messages");
  const [form, setForm] = useState<OutreachSettings | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    contactsApi.settings().then((s) => setForm(s ?? BLANK), (err) => setMessage({ kind: "error", text: String(err?.message ?? err) }));
  }, []);

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/contacts">Contacts</Link>
        <ChevronRight {...ICON} size={14} />
        <span>Your details</span>
      </nav>
      <div className="page-head">
        <div>
          <h1>Your details for messages</h1>
          <p className="lede">Every LinkedIn note, e-mail and WhatsApp message is written from these. You still read and send each one yourself.</p>
        </div>
      </div>
      {message && (
        <Notice kind={message.kind} onClose={() => setMessage(null)}>
          {message.text}
        </Notice>
      )}
      {form && (
        <form
          className="panel panel-pad stack form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await contactsApi.saveSettings(form);
              setMessage({ kind: "ok", text: "Saved." });
            } catch (err) {
              setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
            }
          }}
        >
          {FIELDS.map((f) => (
            <label key={f.key} className="field">
              {f.label}
              <input value={(form[f.key] as string | null) ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value || null })} />
              {f.hint && <span className="hint">{f.hint}</span>}
            </label>
          ))}
          <label className="field">
            Follow up every
            <select value={form.cadence_days} onChange={(e) => setForm({ ...form, cadence_days: Number(e.target.value) })}>
              <option value={2}>2 days</option>
              <option value={3}>3 days</option>
            </select>
          </label>
          <div className="row">
            <button className="btn primary" type="submit">
              Save
            </button>
          </div>
        </form>
      )}
    </>
  );
}
