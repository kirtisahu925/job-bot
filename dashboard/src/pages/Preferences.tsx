import { useEffect, useState } from "react";
import { Notice } from "../components/bits";
import { ChipInput } from "../components/ChipInput";
import { ago } from "../lib/format";
import { useTitle } from "../lib/useTitle";
import { workspaceApi, type JobAge, type Preferences as Prefs } from "../lib/workspace";

// the tracks and cities in config/search.yaml; leaving them all unticked keeps the file's choice
const TRACKS: [string, string][] = [
  ["java", "Java backend"],
  ["python", "Python backend"],
  ["fullstack", "Full-stack JS / Node"],
];
const CITIES = ["Gurugram", "Noida", "Delhi", "Bengaluru", "Hyderabad", "Pune", "Chennai", "Mumbai"];
const LEVELS = ["SDE-1", "SDE-2", "SDE-3", "Senior Software Engineer"];
const TITLE_SUGGESTIONS = [
  "Full Stack Java Developer",
  "Java Developer",
  "Java Spring Boot Developer",
  "Backend Engineer",
  "Software Engineer II",
  "SDE 2",
  "Python Backend Developer",
  "Node.js Developer",
];

// how recent a job must be: shorter windows give the scoring budget to fresh jobs, where replies are likelier
const JOB_AGES: [JobAge, string, string][] = [
  [1, "24 hours", "Freshest; what the twice-daily scans are built for"],
  [3, "3 days", "Also catches jobs a site listed late"],
  [7, "7 days", "A week of jobs; more to sort through"],
  [30, "30 days", "The most jobs; older ones are likelier filled"],
];

// common deal-breakers in Indian job ads; matched as whole words in the title and description
const DEAL_BREAKERS = [
  "night shift",
  "rotational shift",
  "service agreement",
  "bond period",
  "contract to hire",
  "C2H",
  "third-party payroll",
  "6 days working",
];

const BLANK: Prefs = {
  target_level: "",
  target_roles: [],
  emphasize: [],
  de_emphasize: [],
  resume_notes: "",
  tracks: [],
  cities: [],
  include_remote: null,
  max_required_years: null,
  exclude_title_words: [],
  min_salary_lpa: null,
  max_job_age_days: null,
  skip_companies: [],
  skip_phrases: [],
  skip_it_services: null,
};

export default function Preferences() {
  useTitle("Preferences");
  const [p, setP] = useState<Prefs | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    workspaceApi.userSettings().then(
      (s) => {
        setP({ ...BLANK, ...s.preferences });
        setSaved(s.updated_at);
      },
      (e: Error) => setMessage({ kind: "error", text: e.message }),
    );
  }, []);

  if (!p)
    return (
      <>
        <div className="page-head">
          <div>
            <h1>Preferences</h1>
          </div>
        </div>
        {message && <Notice kind="error">{message.text}</Notice>}
      </>
    );

  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setP({ ...p, [k]: v });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Preferences</h1>
          <p className="lede">
            What you are aiming for and what the scans should look for. The next scan and every Tailor now read these; anything left blank
            keeps the repo's config/search.yaml.{saved ? ` Last saved ${ago(saved)}.` : ""}
          </p>
        </div>
      </div>
      {message && (
        <Notice kind={message.kind} onClose={() => setMessage(null)}>
          {message.text}
        </Notice>
      )}

      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await workspaceApi.savePreferences(p);
            setSaved(new Date().toISOString());
            setMessage({ kind: "ok", text: "Saved. The next scan or Tailor now uses these." });
          } catch (err) {
            setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <section className="panel panel-pad form" aria-labelledby="aim-h">
          <div>
            <h2 id="aim-h">What you are aiming for</h2>
            <p className="small muted">The resume writer reads these first, and both reviewers judge the resume against them.</p>
          </div>
          <div className="two">
            <label>
              Level
              <input list="levels" value={p.target_level} onChange={(e) => set("target_level", e.target.value)} placeholder="e.g. SDE-2" />
              <datalist id="levels">
                {LEVELS.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </label>
            <ChipInput
              label="Job titles you want"
              value={p.target_roles}
              onChange={(v) => set("target_roles", v)}
              suggestions={TITLE_SUGGESTIONS}
              placeholder="e.g. Full Stack Java Developer, then Enter"
              hint="Searched on every job site at each scan, allowed as your resume headline, and never skipped by the title rules."
            />
          </div>
          <div className="two">
            <ChipInput
              label="Bring forward"
              value={p.emphasize}
              onChange={(v) => set("emphasize", v)}
              placeholder="e.g. Java and Spring Boot"
              hint="What your resumes should lead with, when a job allows it."
            />
            <ChipInput
              label="Play down"
              value={p.de_emphasize}
              onChange={(v) => set("de_emphasize", v)}
              placeholder="e.g. front-end work"
              hint="Kept short or left out unless a job asks for it."
            />
          </div>
          <label>
            Anything else the writer should know
            <textarea
              rows={3}
              style={{ minHeight: 0 }}
              value={p.resume_notes}
              onChange={(e) => set("resume_notes", e.target.value)}
              placeholder="e.g. I'm moving from Python to Java roles; show the Java work first."
            />
            <span className="hint">Guidance only: the resume still uses only facts from your profile.</span>
          </label>
        </section>

        <section className="panel panel-pad form" aria-labelledby="scan-h">
          <div>
            <h2 id="scan-h">What the scans look for</h2>
            <p className="small muted">Filters run before any AI call, so tightening them also saves your free quota.</p>
          </div>
          <fieldset className="plain">
            <legend>Jobs posted within</legend>
            <div className="age-options">
              {JOB_AGES.map(([days, label, note]) => (
                <label className="provider" key={days}>
                  <input type="radio" name="job-age" checked={p.max_job_age_days === days} onChange={() => set("max_job_age_days", days)} />
                  <span>
                    <strong>{label}</strong>
                    <span className="small muted provider-note">{note}</span>
                  </span>
                </label>
              ))}
            </div>
            <span className="hint">
              Every job site is asked for this window, and anything older is dropped before scoring. Each run scores at most 30 new jobs,
              so a longer window spends that allowance on older jobs; a shorter one often leaves part of it unused. Jobs without a posting
              date are kept.{" "}
              {p.max_job_age_days == null && "Not chosen yet: each site uses its own window (24 hours on LinkedIn, 13 hours on Indeed and Naukri, 30 days on company boards)."}
            </span>
          </fieldset>
          <fieldset className="plain">
            <legend>Kinds of role</legend>
            <div className="row" style={{ gap: 16 }}>
              {TRACKS.map(([key, label]) => (
                <label key={key} className="check">
                  <input
                    type="checkbox"
                    checked={p.tracks.includes(key)}
                    onChange={(e) => set("tracks", e.target.checked ? [...p.tracks, key] : p.tracks.filter((t) => t !== key))}
                  />
                  {label}
                </label>
              ))}
            </div>
            <span className="hint">None ticked: all three, as in the config.</span>
          </fieldset>
          <ChipInput
            label="Cities"
            value={p.cities}
            onChange={(v) => set("cities", v)}
            suggestions={CITIES}
            placeholder="Pick or type a city"
            hint="Empty: Gurugram, Noida, Delhi, Bengaluru, Hyderabad, Pune and Chennai, as in the config."
          />
          <div className="two">
            <label>
              Remote jobs
              <select
                value={p.include_remote == null ? "" : p.include_remote ? "yes" : "no"}
                onChange={(e) => set("include_remote", e.target.value === "" ? null : e.target.value === "yes")}
              >
                <option value="">As in the config (included)</option>
                <option value="yes">Include remote jobs open to India</option>
                <option value="no">Leave remote jobs out</option>
              </select>
            </label>
            <label>
              Skip jobs asking for more than
              <input
                type="number"
                min={0}
                max={25}
                value={p.max_required_years ?? ""}
                onChange={(e) => set("max_required_years", num(e.target.value))}
                placeholder="4 years (config)"
              />
            </label>
          </div>
          <div className="two">
            <ChipInput
              label="Also skip titles with"
              value={p.exclude_title_words}
              onChange={(v) => set("exclude_title_words", v)}
              placeholder="e.g. blockchain"
              hint="Added to the config's list (lead, manager, intern, QA and others)."
            />
            <label>
              Minimum salary (LPA)
              <input type="number" min={0} step="any" value={p.min_salary_lpa ?? ""} onChange={(e) => set("min_salary_lpa", num(e.target.value))} placeholder="No minimum" />
              <span className="hint">Only drops jobs that state a lower rupee salary; most ads state none and are kept.</span>
            </label>
          </div>
          <div className="two">
            <ChipInput
              label="Never show jobs from"
              value={p.skip_companies}
              onChange={(v) => set("skip_companies", v)}
              placeholder="e.g. Acme Corp, then Enter"
              hint="Their divisions too: Infosys also skips Infosys BPM, but not a company that only starts with the same letters."
            />
            <ChipInput
              label="Skip jobs that mention"
              value={p.skip_phrases}
              onChange={(v) => set("skip_phrases", v)}
              suggestions={DEAL_BREAKERS}
              placeholder="e.g. night shift"
              hint="Deal-breakers, matched as whole words in the title and description."
            />
          </div>
          <label className="check">
            <input type="checkbox" checked={!!p.skip_it_services} onChange={(e) => set("skip_it_services", e.target.checked)} />
            Skip IT-services companies (TCS, Infosys, Wipro, Accenture, Cognizant and the others listed in config/search.yaml)
          </label>
        </section>

        <div className="form-actions">
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save preferences"}
          </button>
          <button className="btn quiet" type="button" onClick={() => setP(BLANK)}>
            Clear all (use the config)
          </button>
        </div>
      </form>
    </>
  );
}
