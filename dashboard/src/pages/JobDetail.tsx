import { ChevronRight, ExternalLink, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import AtsPanel from "../components/AtsPanel";
import CoverLetter from "../components/CoverLetter";
import {
  AtsScore,
  ICON,
  LEGITIMACY_LABEL,
  MatchScore,
  Notice,
  PdfButton,
  ResumeAction,
  SourceTags,
  StatusSelect,
  VERDICT_LABEL,
} from "../components/bits";
import { api } from "../lib/api";
import { ago } from "../lib/format";
import { tailorPhase, useTailorNow, type TailorMessage } from "../lib/tailor";
import type { Job, JobStatus } from "../lib/types";
import { useTitle } from "../lib/useTitle";

function Prop({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="prop">
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

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

  if (error) return <Notice kind="error">{error}</Notice>;
  if (job === undefined) return <p className="muted">Loading job…</p>;
  if (job === null)
    return (
      <Notice>
        This job is not in your tracker. <Link to="/jobs">Back to jobs</Link>
      </Notice>
    );

  const t = job.tailorings[0];
  // One source for "not in your profile", so the Match and ATS panels never disagree: the tailored resume's
  // ATS gaps when there is one, else the job's extracted keywords, else the scan's list; always minus what you now list.
  const kw = job.jd_keywords;
  const missing = (t?.ats?.missing_gaps ?? (kw ? [...kw.required, ...kw.preferred] : job.missing_keywords)).filter((k) => !have.has(k.toLowerCase()));
  // a notice carried over from "Add a job" only matters while that run is still in flight
  const notice = tailor.message ?? (arrived && (arrived.kind === "error" || phase === "tailoring") ? arrived : null);
  const update = async (patch: Partial<Pick<Job, "status" | "notes">>) => {
    setJob({ ...job, ...patch });
    await api.updateJob(job.id, patch);
  };

  return (
    <>
      <div className="crumbs">
        <Link to="/jobs">Jobs</Link>
        <ChevronRight {...ICON} size={13} />
        <span>{job.company}</span>
      </div>
      <div className="page-head">
        <div style={{ minWidth: 0, flex: "1 1 420px" }}>
          <h1>{job.title}</h1>
          <p className="lede">
            {job.company} · {job.remote ? "Remote" : job.location ?? "location not given"} · found {ago(job.created_at)}
            {job.min_years != null && ` · asks ${job.min_years}+ years`}
          </p>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          {phase === "ready" ? (
            <>
              <button className="btn" onClick={() => tailor.start(job)} disabled={tailor.busy === job.id}>
                <RefreshCw {...ICON} size={14} />
                {tailor.busy === job.id ? "Starting…" : "Tailor again"}
              </button>
              {job.apply_url && (
                <a className="btn primary" href={job.apply_url} target="_blank" rel="noreferrer">
                  Apply
                  <ExternalLink {...ICON} size={14} />
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

          {t?.cover_letter && <CoverLetter text={t.cover_letter} />}

          <section className="panel panel-pad" aria-labelledby="jd-h">
            <h2 id="jd-h" style={{ marginBottom: 12 }}>
              Job description
            </h2>
            <div className="jd">{job.description || "No description saved for this job."}</div>
          </section>
        </div>

        <aside className="props" aria-label="Properties">
          <section className="panel panel-pad">
            <dl className="prop-list">
              <Prop term="Status">
                <StatusSelect status={job.status} onChange={(s: JobStatus) => update({ status: s })} label="Status" showLabel />
              </Prop>
              <Prop term="Match">
                <span className="row" style={{ gap: 6 }}>
                  <MatchScore score={job.llm_score} />
                  <span className="muted xs">/ 100</span>
                </span>
              </Prop>
              <Prop term="ATS">
                <AtsScore pill score={job.ats_score ?? t?.ats_score} />
              </Prop>
              {job.verdict && (
                <Prop term="Verdict">
                  <span className={job.verdict === "skip" ? "bad" : job.verdict === "apply" ? "good" : undefined}>{VERDICT_LABEL[job.verdict]}</span>
                </Prop>
              )}
              {job.legitimacy && (
                <Prop term="Posting">
                  <span className={job.legitimacy === "suspicious" ? "warn" : undefined}>{LEGITIMACY_LABEL[job.legitimacy]}</span>
                </Prop>
              )}
              <Prop term="Location">{job.remote ? "Remote" : job.location ?? "–"}</Prop>
              <Prop term="Found">{ago(job.created_at)}</Prop>
            </dl>
            {job.score_reason && <p className="soft small">{job.score_reason}</p>}
            {!!job.hard_stops?.length && (
              <div>
                <h3 className="xs muted" style={{ marginBottom: 6, fontWeight: 500 }}>
                  Why not to apply
                </h3>
                <ul className="eval-notes bad">
                  {job.hard_stops.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!job.legitimacy_signals?.length && (
              <div>
                <h3 className="xs muted" style={{ marginBottom: 6, fontWeight: 500 }}>
                  What the posting shows
                </h3>
                <ul className="eval-notes">
                  {job.legitimacy_signals.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {missing.length > 0 && (
              <div>
                <h3 className="xs muted" style={{ marginBottom: 8, fontWeight: 500 }}>
                  Asked for, not in your profile
                </h3>
                <div className="tags">
                  {missing.map((k) => (
                    <Link className="tag hidden-line" key={k} to={`/skills#${encodeURIComponent(k.toLowerCase())}`}>
                      {k}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            <div>
              <h3 className="xs muted" style={{ marginBottom: 8, fontWeight: 500 }}>
                Posted on
              </h3>
              <SourceTags links={job.job_links} />
            </div>
          </section>

          {t && (
            <section className="panel panel-pad" aria-labelledby="resume-h">
              <div className="section-head" style={{ marginBottom: 0 }}>
                <h2 id="resume-h">Tailored resume</h2>
                <span className="muted xs">{ago(t.created_at)}</span>
              </div>
              <div className="row">
                <PdfButton path={t.pdf_path} label="Open PDF" small={false} />
                <PdfButton path={t.tex_path} label="LaTeX" small={false} />
              </div>
              <dl className="prop-list">
                <Prop term="Checks">
                  <span className={t.status === "ok" ? "good" : "warn"}>{t.status === "ok" ? "Passed layout checks" : "Needs a look"}</span>
                </Prop>
                <Prop term="Length">
                  {t.pages ?? "?"} page{t.pages === 1 ? "" : "s"}
                  {t.fill_ratio != null && <span className="muted xs"> · {Math.round(t.fill_ratio * 100)}% filled</span>}
                </Prop>
                <Prop term="Revisions">{t.revisions ?? 0}</Prop>
                <Prop term="Model">
                  <span className="soft">{t.model ?? "–"}</span>
                </Prop>
              </dl>
              {!!t.lint_issues?.length && (
                <div>
                  <h3 className="xs muted" style={{ marginBottom: 6, fontWeight: 500 }}>
                    Open issues
                  </h3>
                  <ul className="small soft" style={{ margin: 0, paddingLeft: 18 }}>
                    {t.lint_issues.map((i, n) => (
                      <li key={n}>{i.message}</li>
                    ))}
                  </ul>
                </div>
              )}
              {t.verification && (
                <div className="stack" style={{ gap: 10 }}>
                  <div>
                    <h3 className="xs muted" style={{ fontWeight: 500 }}>
                      Read as an ATS parser
                    </h3>
                    <p className="small soft" style={{ marginTop: 4 }}>
                      {t.verification.ats_parser}
                    </p>
                  </div>
                  <div>
                    <h3 className="xs muted" style={{ fontWeight: 500 }}>
                      Read as a hiring manager
                    </h3>
                    <p className="small soft" style={{ marginTop: 4 }}>
                      {t.verification.hiring_manager}
                    </p>
                  </div>
                </div>
              )}
              {!!t.fixes?.length && (
                <div>
                  <h3 className="xs muted" style={{ marginBottom: 6, fontWeight: 500 }}>
                    Corrections the bot made
                  </h3>
                  <ul className="small soft" style={{ margin: 0, paddingLeft: 18 }}>
                    {t.fixes.map((f, n) => (
                      <li key={n}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          <section className="panel panel-pad" aria-labelledby="notes-h">
            <h2 id="notes-h">Notes</h2>
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
            <div className="row">
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
              {saved === "saved" && <span className="muted xs">Saved</span>}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
