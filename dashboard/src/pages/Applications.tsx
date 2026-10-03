import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AtsScore, Empty, Notice, PdfButton, SkeletonRows, StatusSelect } from "../components/bits";
import { DueTag } from "../components/contacts";
import {
  ACTIVE_APPLICATION,
  APPLICATION_STATUSES,
  daysSince,
  funnel,
  nextStepFor,
  review,
  stageSince,
  type StatusEvent,
} from "../lib/applications";
import { countBy } from "../lib/companyMatch";
import { contactsApi } from "../lib/contacts/api";
import { dueLabel } from "../lib/contacts/cadence";
import { sourceLabel } from "../lib/format";
import { STATUS_LABEL, type JobStatus } from "../lib/types";
import { useJobs } from "../lib/useJobs";
import { useTitle } from "../lib/useTitle";
import { workspaceApi, type Company } from "../lib/workspace";

type View = "active" | "closed" | "all";
const ORDER: JobStatus[] = ["offer", "interviewing", "applied", "rejected"];
const date = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export default function Applications() {
  useTitle("Applications");
  const { jobs, error, setStatus } = useJobs();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contactCompanies, setContactCompanies] = useState<string[]>([]);
  const [view, setView] = useState<View>("active");
  const [events, setEvents] = useState<StatusEvent[]>([]);

  useEffect(() => {
    workspaceApi.companies().then(setCompanies, () => setCompanies([]));
    workspaceApi.jobEvents(2000).then(
      (rows) => setEvents(rows.filter((e) => e.kind === "status")),
      () => setEvents([]),
    );
    contactsApi
      .features()
      .then(async (f) => {
        if (!f.includes("contacts")) return;
        const [cos, people] = await Promise.all([contactsApi.companies(), contactsApi.contacts()]);
        const withPeople = new Set(people.map((p) => p.company_id));
        setContactCompanies(cos.filter((c) => withPeople.has(c.id)).map((c) => c.name));
      })
      .catch(() => undefined);
  }, []);

  const apps = useMemo(() => (jobs ?? []).filter((j) => APPLICATION_STATUSES.includes(j.status)), [jobs]);
  const f = funnel(apps);
  const now = new Date();
  const weekly = useMemo(() => review(apps, events, { label: sourceLabel }), [apps, events]);

  const bracketOf = useMemo(() => {
    const by = countBy(
      companies.map((c) => c.name),
      apps,
      (j) => j.company,
    );
    const out = new Map<string, string>();
    for (const c of companies)
      if (c.salary_min_lpa != null && c.salary_max_lpa != null) for (const j of by.get(c.name) ?? []) out.set(j.id, `${c.salary_min_lpa}–${c.salary_max_lpa}`);
    return out;
  }, [companies, apps]);
  const contactsFor = useMemo(() => {
    const by = countBy(contactCompanies, apps, (j) => j.company);
    return new Set([...by.values()].flat().map((j) => j.id));
  }, [contactCompanies, apps]);

  const shown = apps
    .filter((j) => (view === "all" ? true : view === "active" ? ACTIVE_APPLICATION.includes(j.status) : j.status === "rejected"))
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || stageSince(a).getTime() - stageSince(b).getTime());

  const views: { key: View; label: string; n: number }[] = [
    { key: "active", label: "In progress", n: f.waiting + f.interviewing + f.offers },
    { key: "closed", label: "Rejected", n: f.rejected },
    { key: "all", label: "All", n: f.total },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Applications</h1>
          <p className="lede">
            Every job you applied to, from the day you applied to the offer. Follow up every 2-3 days until they answer, and say yes to a
            face-to-face round when they offer one.
          </p>
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}

      {jobs && (
        <dl className="ledger" aria-label="Applications summary">
          <div>
            <dt>Applied</dt>
            <dd>{f.total}</dd>
          </div>
          <div>
            <dt>Waiting</dt>
            <dd>{f.waiting}</dd>
          </div>
          <div>
            <dt>Interviewing</dt>
            <dd>{f.interviewing}</dd>
          </div>
          <div>
            <dt>Offers</dt>
            <dd>{f.offers}</dd>
          </div>
          <div>
            <dt>Heard back</dt>
            <dd>
              {f.total ? `${Math.round((f.heardBack / f.total) * 100)}%` : "–"}
              <span className="small">
                {f.heardBack} of {f.total}
              </span>
            </dd>
          </div>
        </dl>
      )}

      <div className="toolbar" style={{ marginTop: 14 }}>
        <div className="tabs" role="group" aria-label="Which applications">
          {views.map((v) => (
            <button key={v.key} aria-pressed={view === v.key} onClick={() => setView(v.key)}>
              {v.label} <span className="count">{v.n}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="panel table-wrap">
        <table className="entries">
          <thead>
            <tr>
              <th>Role</th>
              <th>Stage</th>
              <th className="only-wide">Applied</th>
              <th className="only-wide">Resume</th>
              <th>Next step</th>
            </tr>
          </thead>
          <tbody>
            {!jobs && <SkeletonRows cols={5} rows={5} />}
            {shown.map((j) => {
              const step = nextStepFor(j, { now, bracket: bracketOf.get(j.id), hasContacts: contactsFor.has(j.id) });
              const applied = j.applied_at ? new Date(j.applied_at) : null;
              const t = j.tailorings[0];
              return (
                <tr key={j.id}>
                  <td className="cell-role">
                    <Link className="role-title" to={`/jobs/${j.id}`}>
                      {j.title}
                    </Link>
                    <div className="role-sub">
                      {j.company}
                      {bracketOf.has(j.id) && <span className="muted"> · {bracketOf.get(j.id)} LPA</span>}
                    </div>
                  </td>
                  <td className="cell-scores">
                    <StatusSelect status={j.status} onChange={(s) => setStatus(j.id, s)} label={`Stage of ${j.title} at ${j.company}`} showLabel />
                    <div className="xs muted">for {daysSince(stageSince(j), now)}d</div>
                  </td>
                  <td className="only-wide num">
                    {applied ? (
                      <>
                        {date(applied)}
                        <div className="xs muted">{daysSince(applied, now)} days ago</div>
                      </>
                    ) : (
                      <span className="muted">Not recorded</span>
                    )}
                  </td>
                  <td className="only-wide">
                    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <AtsScore score={j.ats_score ?? t?.ats_score} pill />
                      {t?.pdf_path && <PdfButton path={t.pdf_path} label="PDF" />}
                    </div>
                  </td>
                  <td className="cell-status next-cell">
                    <div className="row" style={{ gap: 8 }}>
                      <strong className="next-title">{step.action}</strong>
                      <DueTag label={dueLabel(step.due, now)} />
                    </div>
                    <div className="reason">{step.why}</div>
                    {j.status === "applied" && contactsFor.has(j.id) && (
                      <Link className="small" to={`/contacts?q=${encodeURIComponent(j.company)}`}>
                        Your contacts at {j.company}
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {jobs && shown.length === 0 && (
          <Empty title={f.total ? `No ${view === "closed" ? "rejections" : "applications in progress"}` : "No applications yet"}>
            {f.total
              ? "Switch to All to see every application."
              : `When you apply, set the job to ${STATUS_LABEL.applied} (on the job, the board, or the extension's "Mark as applied") and it is tracked here from that day.`}
          </Empty>
        )}
      </div>

      {jobs && f.total > 0 && (
        <section className="panel panel-pad stack review" aria-labelledby="review-h" style={{ marginTop: 20 }}>
          <div>
            <h2 id="review-h">How your applications are doing</h2>
            <p className="small muted">Read from your application stages and when they changed. Updated as you move jobs along.</p>
          </div>
          <dl className="ledger" aria-label="Application review">
            <div>
              <dt>Replied</dt>
              <dd>
                {Math.round((weekly.replies / weekly.applied) * 100)}%<span className="small">{weekly.replies} of {weekly.applied}</span>
              </dd>
            </div>
            <div>
              <dt>Reached interview</dt>
              <dd>{weekly.interviews}</dd>
            </div>
            <div>
              <dt>Likely ghosted</dt>
              <dd>
                {weekly.ghosted}
                <span className="small">no reply in 3+ weeks</span>
              </dd>
            </div>
            <div>
              <dt>Typical wait for a reply</dt>
              <dd>{weekly.medianDaysToReply == null ? "–" : `${weekly.medianDaysToReply} day${weekly.medianDaysToReply === 1 ? "" : "s"}`}</dd>
            </div>
          </dl>
          <ul className="findings-list">
            {weekly.findings.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {weekly.bySource.length > 1 && (
            <div className="table-wrap">
              <table className="by-source">
                <caption className="visually-hidden">Replies by job site</caption>
                <thead>
                  <tr>
                    <th>Found on</th>
                    <th className="right">Applied</th>
                    <th className="right">Replied</th>
                  </tr>
                </thead>
                <tbody>
                  {weekly.bySource.map((r) => (
                    <tr key={r.source}>
                      <td>{sourceLabel(r.source)}</td>
                      <td className="right num">{r.applied}</td>
                      <td className="right num">
                        {r.replies} <span className="muted xs">({Math.round((r.replies / r.applied) * 100)}%)</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
