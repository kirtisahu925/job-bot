import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PdfLink, ScoreBadge, SourceBadges } from "../components/bits";
import { ago, sourceLabel } from "../lib/format";
import { STATUS_LABEL, STATUSES, type JobStatus } from "../lib/types";
import { useJobs } from "../lib/useJobs";

const RANGES = [
  { label: "Last 24 hours", days: 1 },
  { label: "Last 3 days", days: 3 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "All time", days: 0 },
];

export default function Jobs() {
  const { jobs, error, setStatus } = useJobs();
  const [q, setQ] = useState("");
  const [status, setStatusFilter] = useState<"active" | JobStatus | "all">("active");
  const [track, setTrack] = useState("all");
  const [source, setSource] = useState("all");
  const [minScore, setMinScore] = useState(0);
  const [range, setRange] = useState(7);

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

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Jobs</h1>
          <div className="muted">
            {jobs ? `${shown.length} of ${jobs.length} jobs` : "Loading…"} · scanned at 10:00 and 22:00 IST
          </div>
        </div>
      </div>
      {error && <div className="banner error">{error}</div>}
      <div className="filters">
        <select value={range} onChange={(e) => setRange(Number(e.target.value))} aria-label="Found within">
          {RANGES.map((r) => (
            <option key={r.days} value={r.days}>
              {r.label}
            </option>
          ))}
        </select>
        <input type="text" placeholder="Search title, company, city" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatusFilter(e.target.value as typeof status)} aria-label="Status">
          <option value="active">Active (hide skipped/rejected)</option>
          <option value="all">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select value={track} onChange={(e) => setTrack(e.target.value)} aria-label="Track">
          <option value="all">All tracks</option>
          <option value="java">Java backend</option>
          <option value="python">Python backend</option>
          <option value="fullstack">Full-stack JS</option>
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
          <option value="all">All sources</option>
          {allSources.map((s) => (
            <option key={s} value={s}>
              {sourceLabel(s)}
            </option>
          ))}
        </select>
        <label>
          Min score
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            style={{ width: 70 }}
          />
        </label>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Score</th>
              <th>Role</th>
              <th className="hide-sm">Location</th>
              <th>Found on</th>
              <th>Status</th>
              <th className="hide-sm">Found</th>
              <th>Resume</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((j) => (
              <tr key={j.id}>
                <td>
                  <ScoreBadge score={j.llm_score} />
                </td>
                <td>
                  <Link to={`/jobs/${j.id}`} style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                    {j.title}
                  </Link>
                  <div className="secondary">{j.company}</div>
                  {j.score_reason && <div className="muted" style={{ fontSize: 12 }}>{j.score_reason}</div>}
                </td>
                <td className="hide-sm">{j.remote ? "Remote" : j.city ?? j.location}</td>
                <td>
                  <SourceBadges links={j.job_links} />
                </td>
                <td>
                  <select
                    value={j.status}
                    onChange={(e) => setStatus(j.id, e.target.value as JobStatus)}
                    aria-label={`Status of ${j.title}`}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="hide-sm muted">{ago(j.created_at)}</td>
                <td>
                  {j.tailorings[0]?.pdf_path ? (
                    <PdfLink path={j.tailorings[0].pdf_path} />
                  ) : j.status === "tailor_queued" ? (
                    <span className="muted">next run</span>
                  ) : (
                    <button className="btn small" onClick={() => setStatus(j.id, "tailor_queued")}>
                      Tailor
                    </button>
                  )}
                </td>
                <td>
                  {j.apply_url && (
                    <a className="btn small" href={j.apply_url} target="_blank" rel="noreferrer">
                      Apply ↗
                    </a>
                  )}
                </td>
              </tr>
            ))}
            {jobs && shown.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No jobs match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
