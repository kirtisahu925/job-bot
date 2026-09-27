import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PdfLink, ScoreBadge, SourceBadges, StatusBadge } from "../components/bits";
import { api } from "../lib/api";
import { ago } from "../lib/format";
import { STATUS_LABEL, STATUSES, type Job, type JobStatus } from "../lib/types";

export default function JobDetail() {
  const { id } = useParams();
  const [job, setJob] = useState<Job | null | undefined>(undefined);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.getJob(id).then(
      (j) => {
        setJob(j);
        setNotes(j?.notes ?? "");
      },
      (e: Error) => setError(e.message),
    );
  }, [id]);

  if (error) return <div className="banner error">{error}</div>;
  if (job === undefined) return <div className="muted">Loading…</div>;
  if (job === null) return <div className="banner">Job not found. <Link to="/jobs">Back to jobs</Link></div>;

  const t = job.tailorings[0];
  const d = t?.diagnostics;
  const update = async (patch: Partial<Pick<Job, "status" | "notes">>) => {
    setJob({ ...job, ...patch });
    await api.updateJob(job.id, patch);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="muted">
            <Link to="/jobs">Jobs</Link> / {job.company}
          </div>
          <h1>{job.title}</h1>
          <div className="row secondary">
            <span>{job.company}</span>·<span>{job.remote ? "Remote" : job.location}</span>·
            <span>found {ago(job.created_at)}</span>
            {job.min_years != null && <span>· asks {job.min_years}+ yrs</span>}
            {job.captured_by === "extension" && <span className="chip">saved from browser</span>}
          </div>
        </div>
        <div className="row">
          <ScoreBadge score={job.llm_score} />
          <select value={job.status} onChange={(e) => update({ status: e.target.value as JobStatus })} aria-label="Status">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          {job.apply_url && (
            <a className="btn primary" href={job.apply_url} target="_blank" rel="noreferrer">
              Apply ↗
            </a>
          )}
        </div>
      </div>

      <div className="grid cols-2">
        <div className="stack">
          <div className="card">
            <h2>Tailored resume</h2>
            {!t && (
              <div className="row">
                <span className="muted">No resume yet.</span>
                {job.status !== "tailor_queued" ? (
                  <button className="btn small" onClick={() => update({ status: "tailor_queued" })}>
                    Queue for next run
                  </button>
                ) : (
                  <StatusBadge status="tailor_queued" />
                )}
              </div>
            )}
            {t && (
              <>
                <div className="row" style={{ marginBottom: 10 }}>
                  <PdfLink path={t.pdf_path} label="Download PDF" />
                  <PdfLink path={t.tex_path} label="LaTeX source" />
                  <span className="chip">{t.status === "ok" ? "✓ passed checks" : "! needs review"}</span>
                  <span className="muted">
                    {t.pages ?? "?"} page · {t.fill_ratio != null ? `${Math.round(t.fill_ratio * 100)}% filled` : ""} ·{" "}
                    {t.model} · {ago(t.created_at)}
                  </span>
                  <button className="btn small" onClick={() => update({ status: "tailor_queued" })}>
                    Re-tailor
                  </button>
                </div>
                {d && (
                  <table>
                    <tbody>
                      <tr>
                        <th>Match score</th>
                        <td className="num">{d.match_score}/100</td>
                      </tr>
                      <tr>
                        <th>Missing ATS keywords</th>
                        <td>
                          <div className="row" style={{ gap: 4 }}>
                            {d.missing_keywords.map((k) => (
                              <span className="chip" key={k}>
                                {k}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <th>Red flags</th>
                        <td>{d.red_flags.length ? d.red_flags.join("; ") : <span className="muted">none</span>}</td>
                      </tr>
                      <tr>
                        <th>Strong sections</th>
                        <td>{d.strong_sections.join("; ") || "-"}</td>
                      </tr>
                      <tr>
                        <th>Weak sections</th>
                        <td>{d.weak_sections.join("; ") || "-"}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
                {t.verification && (
                  <>
                    <h3 style={{ marginTop: 12 }}>Dual-persona check</h3>
                    <p style={{ margin: "4px 0" }}>
                      <strong>ATS parser:</strong> {t.verification.ats_parser}
                    </p>
                    <p style={{ margin: "4px 0" }}>
                      <strong>Hiring manager:</strong> {t.verification.hiring_manager}
                    </p>
                  </>
                )}
                {!!t.lint_issues?.length && (
                  <>
                    <h3 style={{ marginTop: 12 }}>Open issues</h3>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {t.lint_issues.map((i, n) => (
                        <li key={n}>
                          <span className="muted">[{i.code}]</span> {i.message}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
          <div className="card">
            <h2>Notes</h2>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setSaved(false);
              }}
              placeholder="Referrals, recruiter name, interview dates…"
            />
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="btn small"
                onClick={async () => {
                  await update({ notes });
                  setSaved(true);
                }}
              >
                Save notes
              </button>
              {saved && <span className="muted">Saved</span>}
            </div>
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <h2>Posted on</h2>
            <SourceBadges links={job.job_links} />
            {job.score_reason && <p className="secondary">{job.score_reason}</p>}
            {!!job.missing_keywords.length && (
              <div className="row" style={{ gap: 4 }}>
                <span className="muted">Scoring gaps:</span>
                {job.missing_keywords.map((k) => (
                  <span className="chip" key={k}>
                    {k}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="card">
            <h2>Job description</h2>
            <div style={{ whiteSpace: "pre-wrap", maxHeight: 520, overflow: "auto" }}>{job.description}</div>
          </div>
        </div>
      </div>
    </>
  );
}
