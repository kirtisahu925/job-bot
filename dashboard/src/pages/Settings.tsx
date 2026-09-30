import { LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ICON, Notice } from "../components/bits";
import { api } from "../lib/api";
import { contactsApi } from "../lib/contacts/api";
import { ago } from "../lib/format";
import { useTitle } from "../lib/useTitle";
import { workspaceApi, type BotSettings, type Reviewer } from "../lib/workspace";

// config/search.yaml and config/pricing.yaml: what a blank setting falls back to
const DEFAULTS = { ats_target: 90, ats_minimum: 80, fix_rounds: 1, tailor_per_run: 1, min_score: 75 };
const REVIEWERS: { key: Reviewer; label: string; what: string }[] = [
  { key: "hiring_manager", label: "Hiring manager review", what: "The manager for the role reads the draft the way they screen: top third, evidence, depth in the stack, relevance. Then fixes it." },
  { key: "vp_hiring", label: "VP of hiring review", what: "A senior hiring manager checks level (SDE-2 signals), trajectory, business impact and the story. Then rebuilds it." },
];

// cost per resume: ~20k input and ~6k output tokens over three rounds (measured on your runs), plus thinking
const PROVIDERS = [
  {
    key: "gemini",
    label: "Gemini, free tier",
    cost: "₹0",
    note: "About 20 Flash calls a day, often busy (503): most resumes so far fell back to Flash-Lite. Enabling billing on the same key lifts both limits, at about ₹5 a resume.",
  },
  {
    key: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    cost: "about ₹14",
    note: "Strong writing and reviews at half Opus's price. Needs the ANTHROPIC_API_KEY GitHub secret.",
  },
  {
    key: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    cost: "about ₹28",
    note: "The most careful writer and reviewer. Needs the ANTHROPIC_API_KEY GitHub secret.",
  },
] as const;
type ProviderKey = (typeof PROVIDERS)[number]["key"] | "";

function providerKey(s: Partial<BotSettings>): ProviderKey {
  if (s.llm_provider === "anthropic") return s.claude_model ?? "claude-opus-5-5";
  if (s.llm_provider === "gemini") return "gemini";
  return "";
}

export default function Settings({ email, onSignOut }: { email: string; onSignOut?: () => void }) {
  useTitle("Settings");
  const [s, setS] = useState<Partial<BotSettings> | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [contacts, setContacts] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    workspaceApi.userSettings().then(
      (u) => {
        setS(u.settings);
        setSaved(u.updated_at);
      },
      (e: Error) => setMessage({ kind: "error", text: e.message }),
    );
    contactsApi.features().then((f) => setContacts(f.includes("contacts")), () => undefined);
  }, []);

  const reviewers = s?.reviewers ?? ["hiring_manager", "vp_hiring"];
  const fix = s?.fix_rounds ?? DEFAULTS.fix_rounds;
  const calls = 1 + reviewers.length;
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const set = <K extends keyof BotSettings>(k: K, v: BotSettings[K] | null) => setS({ ...(s ?? {}), [k]: v });
  const provider = s ? providerKey(s) : "";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="lede">
            How resumes are written and how much the bot does per run. The next scan and every Tailor now read these; blank fields keep the
            repo's config.{saved ? ` Last saved ${ago(saved)}.` : ""}
          </p>
        </div>
      </div>
      {message && (
        <Notice kind={message.kind} onClose={() => setMessage(null)}>
          {message.text}
        </Notice>
      )}

      {s && (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await workspaceApi.saveSettings(s);
              setSaved(new Date().toISOString());
              setMessage({ kind: "ok", text: "Saved. The next scan or Tailor now uses these." });
            } catch (err) {
              setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
            } finally {
              setBusy(false);
            }
          }}
        >
          <section className="panel panel-pad form" aria-labelledby="rounds-h">
            <div>
              <h2 id="rounds-h">How each resume is written</h2>
              <p className="small muted">
                {calls} AI call{calls === 1 ? "" : "s"} per resume{fix ? `, ${calls + fix} at most` : ""}. The ATS score is measured in code on the
                compiled PDF, free.
              </p>
            </div>
            <ol className="round-steps">
              <li>
                <strong>Build</strong>
                <span className="small muted">
                  Reads the job description, your skills and your Preferences, reasons about the fit, picks the keywords, then writes the resume.
                </span>
              </li>
              {REVIEWERS.map((r) => (
                <li key={r.key}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={reviewers.includes(r.key)}
                      onChange={(e) =>
                        set(
                          "reviewers",
                          REVIEWERS.map((x) => x.key).filter((k) => (k === r.key ? e.target.checked : reviewers.includes(k))),
                        )
                      }
                    />
                    <strong>{r.label}</strong>
                  </label>
                  <span className="small muted">{r.what}</span>
                </li>
              ))}
              <li>
                <strong>ATS score</strong>
                <span className="small muted">
                  Keywords, title, experience, education and format, read from the PDF. The latest round that clears the minimum and invents
                  nothing is kept.
                </span>
              </li>
            </ol>
            <div className="two">
              <label>
                ATS target
                <input type="number" min={50} max={100} value={s.ats_target ?? ""} placeholder={`${DEFAULTS.ats_target}`} onChange={(e) => set("ats_target", num(e.target.value))} />
                <span className="hint">The reviewers are asked to reach it.</span>
              </label>
              <label>
                ATS minimum
                <input type="number" min={0} max={100} value={s.ats_minimum ?? ""} placeholder={`${DEFAULTS.ats_minimum}`} onChange={(e) => set("ats_minimum", num(e.target.value))} />
                <span className="hint">Below it, or when a hard rule breaks, a fix-up call runs.</span>
              </label>
            </div>
            <label>
              Fix-up calls
              <select value={s.fix_rounds ?? ""} onChange={(e) => set("fix_rounds", num(e.target.value))}>
                <option value="">As in the config (1)</option>
                <option value="0">None</option>
                <option value="1">1</option>
                <option value="2">2</option>
              </select>
            </label>
          </section>

          <section className="panel panel-pad form" aria-labelledby="ai-h">
            <div>
              <h2 id="ai-h">AI for resumes</h2>
              <p className="small muted">Scoring jobs and cover letters stay on free Gemini Flash-Lite whichever you pick. Costs are per resume, three rounds.</p>
            </div>
            <fieldset className="plain provider-list">
              <legend className="visually-hidden">AI provider</legend>
              <label className="provider">
                <input
                  type="radio"
                  name="provider"
                  checked={provider === ""}
                  onChange={() => setS({ ...s, llm_provider: null, claude_model: null })}
                />
                <span>
                  <strong>As in the config</strong>
                  <span className="small muted"> config/pricing.yaml: Gemini</span>
                </span>
              </label>
              {PROVIDERS.map((p) => (
                <label className="provider" key={p.key}>
                  <input
                    type="radio"
                    name="provider"
                    checked={provider === p.key}
                    onChange={() =>
                      setS({
                        ...s,
                        llm_provider: p.key === "gemini" ? "gemini" : "anthropic",
                        claude_model: p.key === "gemini" ? null : p.key,
                      })
                    }
                  />
                  <span>
                    <strong>{p.label}</strong> <span className="num">{p.cost}</span>
                    <span className="small muted provider-note">{p.note}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </section>

          <section className="panel panel-pad form" aria-labelledby="runs-h">
            <div>
              <h2 id="runs-h">Each scheduled scan</h2>
              <p className="small muted">Scans run at 10:00 and 22:00 IST. Tailor now is separate and always available.</p>
            </div>
            <div className="two">
              <label>
                Resumes written automatically
                <input type="number" min={0} max={10} value={s.tailor_per_run ?? ""} placeholder={`${DEFAULTS.tailor_per_run}`} onChange={(e) => set("tailor_per_run", num(e.target.value))} />
                <span className="hint">For the best new matches. 0 leaves every resume to Tailor now.</span>
              </label>
              <label>
                Only for jobs matching at least
                <input type="number" min={0} max={100} value={s.min_score ?? ""} placeholder={`${DEFAULTS.min_score}`} onChange={(e) => set("min_score", num(e.target.value))} />
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={s.cover_letter ?? true} onChange={(e) => set("cover_letter", e.target.checked)} />
              Write a cover letter with each resume (one small free call)
            </label>
          </section>

          <div className="form-actions">
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save settings"}
            </button>
            <button className="btn quiet" type="button" onClick={() => setS({})}>
              Reset all (use the config)
            </button>
          </div>
        </form>
      )}

      <section className="section" aria-labelledby="acct-h">
        <h2 id="acct-h">Account</h2>
        <div className="panel panel-pad stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>
              Signed in as <strong>{email}</strong>
            </span>
            {onSignOut && (
              <button className="btn small" onClick={onSignOut}>
                <LogOut {...ICON} size={14} />
                Sign out
              </button>
            )}
          </div>
          <p className="small muted">
            Also here: <Link to="/preferences">Preferences</Link> for what you are aiming for, <Link to="/consumption">Consumption</Link> for AI
            and job-site usage, <Link to="/runs">Runs</Link> for every scan
            {contacts && (
              <>
                , and <Link to="/contacts/settings">your details for messages</Link> to contacts
              </>
            )}
            . API keys live in GitHub secrets, never on this site.
          </p>
          {api.demo && <p className="small muted">Demo mode: settings are kept only until you reload.</p>}
        </div>
      </section>
    </>
  );
}
