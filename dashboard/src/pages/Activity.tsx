import { FileText, Radar, Send } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AtsScore, Empty, ICON, Notice, StatusIcon } from "../components/bits";
import { ChannelIcon } from "../components/contacts";
import { contactsApi } from "../lib/contacts/api";
import { CHANNEL_LABEL, OUTCOME_LABEL } from "../lib/contacts/cadence";
import { displayName } from "../lib/contacts/model";
import { istDay, istTime } from "../lib/format";
import { STATUS_LABEL, type JobStatus, type Run } from "../lib/types";
import { useTitle } from "../lib/useTitle";
import { workspaceApi, type JobEvent, type ResumeEvent } from "../lib/workspace";

type Kind = "application" | "resume" | "scan" | "outreach" | "job";
const KIND_LABEL: Record<Kind, string> = {
  application: "Applications",
  resume: "Resumes",
  scan: "Scans",
  outreach: "Outreach",
  job: "Other job changes",
};
const APPLICATION: JobStatus[] = ["applied", "interviewing", "offer", "rejected"];

interface Item {
  id: string;
  at: string;
  kind: Kind;
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
}

function runItem(r: Run): Item {
  const s = r.summary ?? {};
  const tailorNow = r.trigger === "tailor-now";
  const parts = tailorNow
    ? [`${r.tailored ?? 0} resume${r.tailored === 1 ? "" : "s"}`]
    : [`${r.new_jobs ?? 0} new job${r.new_jobs === 1 ? "" : "s"}`, `${r.scored ?? 0} scored`, `${r.tailored ?? 0} resume${r.tailored === 1 ? "" : "s"}`];
  const failed = r.status !== "ok" && r.status !== "running";
  return {
    id: `run-${r.id}`,
    at: r.started_at,
    kind: "scan",
    icon: <Radar {...ICON} />,
    title: (
      <>
        {tailorNow ? "Tailor now" : r.trigger === "schedule" ? "Scheduled scan" : "Manual scan"}
        {r.status === "running" ? <span className="warn"> · running</span> : failed ? <span className="bad"> · {r.status}</span> : null}
      </>
    ),
    detail: (
      <>
        {parts.join(", ")}
        {s.errors?.length ? <span className="warn"> · {s.errors.length} problem{s.errors.length === 1 ? "" : "s"}</span> : null} ·{" "}
        <Link to="/runs">Runs</Link>
      </>
    ),
  };
}

function resumeItem(t: ResumeEvent): Item {
  const rounds = (t.rounds ?? []).filter((r) => !r.skipped && r.ats_score != null);
  return {
    id: `res-${t.id}`,
    at: t.created_at,
    kind: "resume",
    icon: <FileText {...ICON} />,
    title: (
      <>
        Resume for <Link to={`/jobs/${t.job_id}`}>{t.job ? `${t.job.title} at ${t.job.company}` : "a job"}</Link>
      </>
    ),
    detail: (
      <span className="row" style={{ gap: 6, display: "inline-flex" }}>
        <AtsScore score={t.ats_score} pill />
        {rounds.length > 1 && <span>{rounds.map((r) => `${r.title.replace(" review", "")} ${r.ats_score}`).join(" → ")}</span>}
        {t.status === "needs_review" && <span className="warn">needs a look</span>}
      </span>
    ),
  };
}

function eventItem(e: JobEvent): Item | null {
  const role = e.job ? `${e.job.title} at ${e.job.company}` : "a job";
  const link = <Link to={`/jobs/${e.job_id}`}>{role}</Link>;
  if (e.kind === "saved")
    return { id: e.id, at: e.at, kind: "job", icon: <Send {...ICON} />, title: <>Saved {link}</>, detail: "from the extension or by hand" };
  const to = e.to_status;
  if (!to || to === "tailored") return null; // the resume itself is its own entry
  return {
    id: e.id,
    at: e.at,
    kind: APPLICATION.includes(to) ? "application" : "job",
    icon: <StatusIcon status={to} size={16} />,
    title: (
      <>
        {STATUS_LABEL[to]}: {link}
      </>
    ),
    detail: e.from_status ? `was ${STATUS_LABEL[e.from_status]}` : undefined,
  };
}

function dayLabel(day: string): string {
  const today = istDay();
  const yesterday = istDay(new Date(Date.now() - 86_400_000));
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  return new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export default function Activity() {
  useTitle("Activity");
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Kind | "all">("all");

  useEffect(() => {
    const outreach = contactsApi
      .features()
      .then(async (f) => {
        if (!f.includes("contacts")) return [];
        const [touches, people, cos] = await Promise.all([contactsApi.touches(), contactsApi.contacts(), contactsApi.companies()]);
        const person = new Map(people.map((p) => [p.id, p]));
        const company = new Map(cos.map((c) => [c.id, c.name]));
        return touches.map((t): Item => {
          const p = person.get(t.contact_id);
          const at = p?.company_id ? company.get(p.company_id) : null;
          return {
            id: `touch-${t.id}`,
            at: t.at,
            kind: "outreach",
            icon: <ChannelIcon channel={t.channel} size={16} />,
            title: (
              <>
                {OUTCOME_LABEL[t.outcome]}: <Link to={`/contacts/${t.contact_id}`}>{p ? displayName(p) : "a contact"}</Link>
                {at && <span className="muted"> at {at}</span>}
              </>
            ),
            detail: [CHANNEL_LABEL[t.channel], t.note].filter(Boolean).join(" · "),
          };
        });
      })
      .catch(() => [] as Item[]);
    Promise.all([workspaceApi.runs(40), workspaceApi.resumes(60), workspaceApi.jobEvents(200), outreach]).then(
      ([runs, resumes, events, touches]) =>
        setItems(
          [
            ...runs.map(runItem),
            ...resumes.map(resumeItem),
            ...(events.map(eventItem).filter(Boolean) as Item[]),
            ...touches,
          ].sort((a, b) => b.at.localeCompare(a.at)),
        ),
      (e: Error) => setError(e.message),
    );
  }, []);

  const kinds = useMemo(() => {
    const present = new Set((items ?? []).map((i) => i.kind));
    return (Object.keys(KIND_LABEL) as Kind[]).filter((k) => present.has(k));
  }, [items]);
  const shown = (items ?? []).filter((i) => filter === "all" || i.kind === filter);
  const days = useMemo(() => {
    const out: [string, Item[]][] = [];
    for (const item of shown) {
      const day = istDay(new Date(item.at));
      if (out.length && out[out.length - 1][0] === day) out[out.length - 1][1].push(item);
      else out.push([day, [item]]);
    }
    return out;
  }, [shown]);
  const week = (items ?? []).filter((i) => Date.now() - new Date(i.at).getTime() < 7 * 86_400_000);
  const count = (k: Kind) => week.filter((i) => i.kind === k).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p className="lede">
            Everything that happened, newest first: scans, resumes, application changes
            {kinds.includes("outreach") ? " and messages to your contacts" : ""}.
          </p>
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {items && (
        <dl className="ledger" aria-label="The last 7 days">
          <div>
            <dt>Last 7 days</dt>
            <dd>
              {count("scan")}
              <span className="small">runs</span>
            </dd>
          </div>
          <div>
            <dt>Resumes</dt>
            <dd>{count("resume")}</dd>
          </div>
          <div>
            <dt>Application changes</dt>
            <dd>{count("application")}</dd>
          </div>
          {kinds.includes("outreach") && (
            <div>
              <dt>Outreach</dt>
              <dd>{count("outreach")}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="toolbar" style={{ marginTop: 14 }}>
        <div className="tabs" role="group" aria-label="Show">
          <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All
          </button>
          {kinds.map((k) => (
            <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {!items && !error && (
        <div className="panel panel-pad" aria-busy>
          <span className="skeleton" style={{ width: "60%" }} />
        </div>
      )}
      {items && shown.length === 0 && (
        <div className="panel">
          <Empty title="Nothing yet">Scans run at 10:00 and 22:00 IST; resumes, applications and messages show up here as they happen.</Empty>
        </div>
      )}
      {days.map(([day, list]) => (
        <section key={day} className="section activity-day" aria-labelledby={`d-${day}`}>
          <h2 id={`d-${day}`} className="group-head">
            {dayLabel(day)} <span className="count">{list.length}</span>
          </h2>
          <ol className="panel feed">
            {list.map((i) => (
              <li key={i.id}>
                <span className="feed-icon" aria-hidden>
                  {i.icon}
                </span>
                <div className="feed-body">
                  <div className="feed-title">{i.title}</div>
                  {i.detail && <div className="feed-detail">{i.detail}</div>}
                </div>
                <time className="xs muted num" dateTime={i.at}>
                  {istTime(i.at)}
                </time>
              </li>
            ))}
          </ol>
        </section>
      ))}
      {items && items.length > 0 && <p className="xs muted footnote">Status changes are recorded from 30 Sep 2026 on; earlier ones show only as the job's current status.</p>}
    </>
  );
}
