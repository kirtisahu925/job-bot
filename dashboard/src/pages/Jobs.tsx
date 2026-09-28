import { Plus, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApplyLink, AtsScore, Empty, ICON, MatchScore, Notice, ResumeAction, SkeletonRows, TitleBlock } from "../components/bits";

const LAST_VISIT = "fairsheet:jobs-last-visit";
import { api } from "../lib/api";
import { ago, istDateTime, istTime, nextScan, sourceLabel } from "../lib/format";
import { tailorPhase, useTailorNow } from "../lib/tailor";
import { STATUS_LABEL, STATUSES, type Balance, type JobStatus, type Run } from "../lib/types";
import { useJobs } from "../lib/useJobs";
import { useTitle } from "../lib/useTitle";

const RANGES = [
  { label: "Last 24 hours", days: 1 },
  { label: "Last 3 days", days: 3 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "All time", days: 0 },
];

export default function Jobs() {
  useTitle("Jobs");
  const { jobs, error, setStatus, replace } = useJobs();
  const tailor = useTailorNow(replace);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatusFilter] = useState<"active" | JobStatus | "all">("active");
  const [track, setTrack] = useState("all");
  const [source, setSource] = useState("all");
  const [minScore, setMinScore] = useState(0);
  const [range, setRange] = useState(7);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // per-viewer convenience: when this browser last opened the Jobs sheet
  const [lastVisit] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_VISIT);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(LAST_VISIT, new Date().toISOString());
    } catch {
      /* storage unavailable: fall back to "since last scan" */
    }
  }, []);

  useEffect(() => {
    api.runs(1).then(setRuns, () => setRuns([]));
    api.latestBalances().then(setBalances, () => setBalances([]));
  }, []);

  // keep watching any Tailor-now run that was already in flight when the page opened
  const { watch } = tailor;
  useEffect(() => {
    for (const j of jobs ?? []) if (tailorPhase(j) === "tailoring") watch(j.id);
  }, [jobs, watch]);

  const allSources = useMemo(
    () => [...new Set((jobs ?? []).flatMap((j) => j.job_links.map((l) => l.source)))].sort(),
    [jobs],
  );

  const shown = useMemo(() => {
    const since = range ? Date.now() - range * 86400000 : 0;
    const needle = q.trim().toLowerCase();
    return (jobs ?? [])
      .filter((j) =>
        status === "all" ? true : status === "active" ? !["skipped", "archived", "rejected"].includes(j.status) : j.status === status,
      )
      .filter((j) => track === "all" || j.track === track)
      .filter((j) => source === "all" || j.job_links.some((l) => l.source === source))
      .filter((j) => (j.llm_score ?? 0) >= minScore)
      .filter((j) => new Date(j.created_at).getTime() >= since)
      .filter((j) => !needle || `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(needle))
      .sort((a, b) => (b.llm_score ?? -1) - (a.llm_score ?? -1) || b.created_at.localeCompare(a.created_at));
  }, [jobs, q, status, track, source, minScore, range]);

  const lastRun = runs?.[0];
  const since = lastVisit ?? lastRun?.started_at ?? null;
  // after a visit: strictly newer; after a scan: everything that scan stored (stamped at or after its start)
  const newSince = jobs && since ? jobs.filter((j) => (lastVisit ? j.created_at > since : j.created_at >= since)).length : null;
  const activeFilters = [range !== 7, status !== "active", track !== "all", source !== "all", minScore > 0].filter(Boolean).length;
  const flash = balances.find((b) => b.provider === "gemini:gemini-flash-latest");
  const next = nextScan();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Jobs</h1>
          <p className="lede">
            {jobs ? `${shown.length} of ${jobs.length} jobs shown, best match first.` : "Loading jobs…"}
          </p>
        </div>
        <TitleBlock
          corner
          label="Scan status"
          cells={[
            { term: "Last scan", value: lastRun ? istDateTime(lastRun.started_at) : runs ? "none yet" : "…" },
            { term: "Next scan", value: `${istTime(next)} IST` },
            { term: lastVisit ? "New since last visit" : "New from last scan", value: newSince ?? "…" },
            {
              term: "Resumes left today",
              value: flash ? `${flash.remaining ?? "?"} / ${flash.limit_value ?? "?"}` : "–",
              sub: flash ? "free Gemini" : undefined,
            },
          ]}
        />
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {tailor.message && (
        <Notice kind={tailor.message.kind} onClose={tailor.clearMessage}>
          {tailor.message.text}
        </Notice>
      )}

      <div className="filters" role="search" data-open={filtersOpen}>
        <label className="grow" style={{ position: "relative" }}>
          <span className="visually-hidden">Search</span>
          <Search {...ICON} style={{ position: "absolute", left: 10, color: "var(--ink-3)" }} />
          <input
            type="search"
            placeholder="Search title, company or city"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: "100%", paddingLeft: 32 }}
          />
        </label>
        <button
          type="button"
          className="btn small filters-toggle"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((o) => !o)}
        >
          <SlidersHorizontal {...ICON} />
          Filters{activeFilters ? ` (${activeFilters})` : ""}
        </button>
        <div className="more">
        <select value={range} onChange={(e) => setRange(Number(e.target.value))} aria-label="Found within">
          {RANGES.map((r) => (
            <option key={r.days} value={r.days}>
              {r.label}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatusFilter(e.target.value as typeof status)} aria-label="Status">
          <option value="active">Open (hide skipped, rejected)</option>
          <option value="all">Every status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select value={track} onChange={(e) => setTrack(e.target.value)} aria-label="Track">
          <option value="all">Every track</option>
          <option value="java">Java backend</option>
          <option value="python">Python backend</option>
          <option value="fullstack">Full-stack JS</option>
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
          <option value="all">Every source</option>
          {allSources.map((s) => (
            <option key={s} value={s}>
              {sourceLabel(s)}
            </option>
          ))}
        </select>
        <label>
          Match at least
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            style={{ width: 72 }}
          />
        </label>
        </div>
      </div>

      <div className="panel table-wrap">
        <table className="entries">
          <thead>
            <tr>
              <th className="right" title="How well the job fits your profile, from the scan">
                Match
              </th>
              <th className="right" title="ATS score of the tailored resume: 80 minimum, 90 target">
                ATS
              </th>
              <th>Role</th>
              <th className="hide-sm">Location</th>
              <th>Status</th>
              <th className="hide-sm">Found</th>
              <th className="right">Next step</th>
            </tr>
          </thead>
          <tbody>
            {!jobs && <SkeletonRows cols={7} />}
            {shown.map((j) => (
              <tr key={j.id}>
                <td className="right only-wide">
                  <MatchScore score={j.llm_score} reason={j.score_reason} />
                </td>
                <td className="right only-wide">
                  <AtsScore score={j.ats_score ?? j.tailorings[0]?.ats_score} />
                </td>
                <td className="cell-role">
                  <Link className="role-title" to={`/jobs/${j.id}`}>
                    {j.title}
                  </Link>
                  <div className="role-sub">
                    {j.company}
                    <span className="only-narrow"> · {j.remote ? "Remote" : j.city ?? j.location}</span>
                  </div>
                  {j.score_reason && <div className="reason hide-sm">{j.score_reason}</div>}
                </td>
                <td className="only-narrow cell-scores">
                  <span className="small muted">Match </span>
                  <MatchScore score={j.llm_score} />
                  <span className="small muted"> · ATS </span>
                  <AtsScore score={j.ats_score ?? j.tailorings[0]?.ats_score} />
                </td>
                <td className="hide-sm only-wide">{j.remote ? "Remote" : j.city ?? j.location}</td>
                <td className="cell-status">
                  <span className="status-cell">
                  <span className={`mark m-${j.status}`} aria-hidden />
                  <select
                    className="compact flat"
                    value={j.status}
                    onChange={(e) => setStatus(j.id, e.target.value as JobStatus)}
                    aria-label={`Status of ${j.title} at ${j.company}`}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  </span>
                </td>
                <td className="hide-sm only-wide muted num">{ago(j.created_at)}</td>
                <td className="act">
                  <div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                    <ResumeAction job={j} onTailor={tailor.start} busy={tailor.busy === j.id} />
                    {tailorPhase(j) === "ready" && <ApplyLink url={j.apply_url} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {jobs && jobs.length === 0 && (
          <Empty
            title="No jobs yet"
            action={
              <Link to="/add" className="btn">
                <Plus {...ICON} />
                Add a job by hand
              </Link>
            }
          >
            The first scan runs at {istTime(next)} IST and fills this sheet with scored matches. You can also paste a job
            description now and tailor a resume for it.
          </Empty>
        )}
        {jobs && jobs.length > 0 && shown.length === 0 && (
          <Empty title="Nothing matches these filters">
            Widen the time range, pick "Every status", or lower the match score to see more.
          </Empty>
        )}
      </div>
    </>
  );
}
