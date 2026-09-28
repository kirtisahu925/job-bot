import { ExternalLink, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import AtsPanel from "../components/AtsPanel";
import { ICON, MatchScore, Notice, PdfButton, ResumeAction, SourceTags } from "../components/bits";
import { api } from "../lib/api";
import { ago } from "../lib/format";
import { tailorPhase, useTailorNow, type TailorMessage } from "../lib/tailor";
import { STATUS_LABEL, STATUSES, type Job, type JobStatus } from "../lib/types";
import { useTitle } from "../lib/useTitle";

export default function JobDetail() {
  const { id } = useParams();
  const location = useLocation();
  const arrived = (location.state as { notice?: TailorMessage | null } | null)?.notice ?? null;
  const [job, setJob] = useState<Job | null | undefined>(undefined);
  const [have, setHave] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  useTitle(job?.title ?? "Job");

  const onJob = useCallback((j: Job) => setJob((prev) => (prev && prev.id === j.id ? { ...prev, ...j } : prev)), []);
  const tailor = useTailorNow(onJob);

  useEffect(() => {
    if (!id) return;
    api.getJob(id).then(
      (j) => {
        setJob(j);
        setNotes(j?.notes ?? "");
      },
      (e: Error) => setError(e.message),
    );
    Promise.all([api.profileSnapshot(), api.skillStatuses()]).then(
      ([p, s]) =>
        setHave(
          new Set([
            ...(p?.skills ?? []).map((x) => x.toLowerCase()),
            ...s.filter((x) => x.status === "known").map((x) => x.skill.toLowerCase()),
          ]),
        ),
      () => undefined,
    );
  }, [id]);

  const { watch } = tailor;
  const phase = job ? tailorPhase(job) : "none";
  useEffect(() => {
    if (job && phase === "tailoring") watch(job.id);
  }, [job, phase, watch]);

  const t = job?.tailorings[0];
  const checks = useMemo(() => {
    if (!t) return null;
    return t.status === "ok" ? "Passed layout checks" : "Needs a look: see open issues";
  }, [t]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (job === undefined) return <p className="muted">Loading job…</p>;
  if (job === null)
    return (
      <Notice>
        This job is not in your tracker. <Link to="/jobs">Back to jobs</Link>
      </Notice>
    );

  // One source for "not in your profile", so the Match and ATS panels never disagree: the tailored resume's
  // ATS gaps when there is one, else the job's extracted keywords, else the scan's list; always minus what you now list.
  const kw = job.jd_keywords;
  const missing = (
    t?.ats?.missing_gaps ?? (kw ? [...kw.required, ...kw.preferred] : job.missing_keywords)
  ).filter((k) => !have.has(k.toLowerCase()));
  // a notice carried over from "Add a job" only matters while that run is still in flight
  const notice = tailor.message ?? (arrived && (arrived.kind === "error" || phase === "tailoring") ? arrived : null);
  const update = async (patch: Partial<Pick<Job, "status" | "notes">>) => {
    setJob({ ...job, ...patch });
    await api.updateJob(job.id, patch);
  };

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0, flex: "1 1 420px" }}>
          <div className="crumbs">
            <Link to="/jobs">Jobs</Link> / {job.company}
          </div>
          <h1>{job.title}</h1>
          <p className="lede">
            {job.company} · {job.remote ? "Remote" : job.location ?? "location not given"} · found {ago(job.created_at)}
            {job.min_years != null && ` · asks ${job.min_years}+ years`}
          </p>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <select value={job.status} onChange={(e) => update({ status: e.target.value as JobStatus })} aria-label="Status">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          {phase === "ready" ? (
            <>
              <button className="btn" onClick={() => tailor.start(job)} disabled={tailor.busy === job.id}>
                <RefreshCw {...ICON} />
                {tailor.busy === job.id ? "Starting…" : "Tailor again"}
              </button>
              {job.apply_url && (
                <a className="btn primary" href={job.apply_url} target="_blank" rel="noreferrer">
                  Apply
                  <ExternalLink {...ICON} />
                </a>
              )}
            </>
          ) : (
            <ResumeAction job={job} onTailor={tailor.start} busy={tailor.busy === job.id} compact={false} />
          )}
        </div>
      </div>

      {notice && (
        <Notice kind={notice.kind} onClose={tailor.message ? tailor.clearMessage : undefined}>
          {notice.text}
        </Notice>
      )}

      <div className="split">
        <div className="stack">
          <AtsPanel job={job} have={have} onTailor={tailor.start} busy={tailor.busy === job.id} />

          <section className="panel panel-pad" aria-labelledby="notes-h">
            <h2 id="notes-h" style={{ marginBottom: 10 }}>
              Notes
            </h2>
            <label className="visually-hidden" htmlFor="notes">
              Notes
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setSaved("idle");
              }}
              placeholder="Referral, recruiter name, interview dates"
            />
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="btn small"
                disabled={saved === "saving" || notes === (job.notes ?? "")}
                onClick={async () => {
                  setSaved("saving");
                  await update({ notes });
                  setSaved("saved");
                }}
              >
                {saved === "saving" ? "Saving…" : "Save notes"}
              </button>
              {saved === "saved" && <span className="muted small">Saved</span>}
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="panel panel-pad" aria-labelledby="match-h">
            <div className="section-head">
              <h2 id="match-h">Match</h2>
              <span>
                <MatchScore score={job.llm_score} /> <span className="muted">/ 100</span>
              </span>
            </div>
            {job.score_reason ? <p className="soft">{job.score_reason}</p> : <p className="muted">Not scored yet.</p>}
            {missing.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <h3 className="small soft" style={{ marginBottom: 6 }}>
                  Asked for, not in your profile
                </h3>
                <div className="tags">
                  {missing.map((k) => (
                    <span className="tag hidden-line" key={k}>
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div style={{ marginTop: 14 }}>
              <h3 className="small soft" style={{ marginBottom: 6 }}>
                Posted on
              </h3>
              <SourceTags links={job.job_links} />
            </div>
          </section>

          {t && (
            <section className="panel panel-pad" aria-labelledby="resume-h">
              <div className="section-head">
                <h2 id="resume-h">Tailored resume</h2>
                <span className="muted small">
                  {t.model ?? "model"} · {ago(t.created_at)}
                </span>
              </div>
              <div className="row" style={{ marginBottom: 14 }}>
                <PdfButton path={t.pdf_path} label="Open PDF" small={false} />
                <PdfButton path={t.tex_path} label="LaTeX source" small={false} />
              </div>
              <dl className="ledger">
                <div>
                  <dt>Checks</dt>
                  <dd className={t.status === "ok" ? "good" : "warn"}>{checks}</dd>
                </div>
                <div>
                  <dt>Length</dt>
                  <dd>
                    {t.pages ?? "?"} page{t.pages === 1 ? "" : "s"}
                    {t.fill_ratio != null && <span className="small">{Math.round(t.fill_ratio * 100)}% of the page filled</span>}
                  </dd>
                </div>
                <div>
                  <dt>Revisions</dt>
                  <dd>{t.revisions ?? 0}</dd>
                </div>
              </dl>
              {t.verification && (
                <div style={{ marginTop: 16 }} className="stack">
                  <div>
                    <h3 className="small soft">Read as an ATS parser</h3>
                    <p style={{ marginTop: 4 }}>{t.verification.ats_parser}</p>
                  </div>
                  <div>
                    <h3 className="small soft">Read as a hiring manager</h3>
                    <p style={{ marginTop: 4 }}>{t.verification.hiring_manager}</p>
                  </div>
                </div>
              )}
              {!!t.lint_issues?.length && (
                <div style={{ marginTop: 16 }}>
                  <h3 className="small soft">Open issues</h3>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                    {t.lint_issues.map((i, n) => (
                      <li key={n}>{i.message}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!!t.fixes?.length && (
                <div style={{ marginTop: 16 }}>
                  <h3 className="small soft">Corrections the bot made</h3>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18 }} className="soft">
                    {t.fixes.map((f, n) => (
                      <li key={n}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          <section className="panel panel-pad" aria-labelledby="jd-h">
            <h2 id="jd-h" style={{ marginBottom: 10 }}>
              Job description
            </h2>
            <div style={{ whiteSpace: "pre-wrap", maxHeight: 640, overflow: "auto", maxWidth: "72ch" }} className="soft">
              {job.description || "No description saved for this job."}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
