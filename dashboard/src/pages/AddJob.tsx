import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Notice } from "../components/bits";
import { api } from "../lib/api";
import type { ManualJob } from "../lib/types";
import { useTitle } from "../lib/useTitle";

const BLANK: ManualJob = { title: "", company: "", location: "", url: "", description: "", tailor: true };

export default function AddJob() {
  useTitle("Add a job");
  const navigate = useNavigate();
  const [job, setJob] = useState<ManualJob>(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = <K extends keyof ManualJob>(k: K) => (v: ManualJob[K]) => setJob((j) => ({ ...j, [k]: v }));

  const tooShort = job.description.trim().length < 200;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Add a job</h1>
          <p className="lede">
            For a job the scans did not find: a referral, a company careers page, a post someone shared. Paste the whole
            description so the resume and ATS score are measured against it.
          </p>
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (tooShort) {
            setError("Paste the full job description (at least a few paragraphs) so the ATS score has something to measure.");
            return;
          }
          setBusy(true);
          setError(null);
          try {
            const id = await api.addManualJob({ ...job, title: job.title.trim(), company: job.company.trim() });
            let notice: { kind: "pending" | "error"; text: string } | null = null;
            if (job.tailor) {
              try {
                notice = { kind: "pending", text: await api.tailorNow(id) };
              } catch (err) {
                notice = { kind: "error", text: `Saved, but Tailor now did not start: ${(err as Error).message}` };
              }
            }
            navigate(`/jobs/${id}`, { state: { notice } });
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <div className="two">
          <label className="field">
            <span>Job title</span>
            <input type="text" required value={job.title} onChange={(e) => field("title")(e.target.value)} placeholder="Backend Engineer (SDE-2)" />
          </label>
          <label className="field">
            <span>Company</span>
            <input type="text" required value={job.company} onChange={(e) => field("company")(e.target.value)} />
          </label>
        </div>
        <div className="two">
          <label className="field">
            <span>Location</span>
            <input type="text" value={job.location} onChange={(e) => field("location")(e.target.value)} placeholder="Bengaluru, or Remote (India)" />
          </label>
          <label className="field">
            <span>Link to the posting</span>
            <input type="url" value={job.url} onChange={(e) => field("url")(e.target.value)} placeholder="https://" />
            <span className="hint">Optional. Used for the Apply button.</span>
          </label>
        </div>
        <label className="field">
          <span>Job description</span>
          <textarea
            required
            value={job.description}
            onChange={(e) => field("description")(e.target.value)}
            placeholder="Paste everything: responsibilities, requirements, nice-to-haves."
          />
          <span className="hint">
            {job.description.trim().length} characters{tooShort && job.description ? "; paste the full description" : ""}
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={job.tailor} onChange={(e) => field("tailor")(e.target.checked)} />
          Tailor a resume for it now (about 3 minutes)
        </label>
        <div className="form-actions">
          <button className="btn primary" disabled={busy} aria-busy={busy}>
            {busy ? "Saving…" : job.tailor ? "Save and tailor" : "Save job"}
          </button>
          <button type="button" className="btn quiet" onClick={() => navigate(-1)} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </>
  );
}
