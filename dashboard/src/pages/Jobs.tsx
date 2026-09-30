import { CornerDownLeft, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ApplyLink,
  AtsScore,
  Empty,
  EvalFlags,
  ICON,
  MatchScore,
  MetaLine,
  Notice,
  ResumeAction,
  SourceBadges,
  StatusIcon,
  StatusSelect,
} from "../components/bits";
import { api } from "../lib/api";
import { ago, istDateTime, istTime, nextScan, sourceLabel } from "../lib/format";
import { tailorPhase, useTailorNow } from "../lib/tailor";
import { STATUS_LABEL, type Balance, type Job, type JobStatus, type Run } from "../lib/types";
import { useJobs } from "../lib/useJobs";
import { useTitle } from "../lib/useTitle";

const LAST_VISIT = "fairsheet:jobs-last-visit";

const RANGES = [
  { label: "Last 24 hours", days: 1 },
  { label: "Last 3 days", days: 3 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "All time", days: 0 },
];

// Groups read top to bottom in the order you act on them: ready to apply first.
const GROUP_ORDER: JobStatus[] = [
  "tailored", "tailor_queued", "shortlisted", "new", "applied", "interviewing", "offer", "rejected", "expired", "skipped", "archived",
];

const VIEWS: { id: string; label: string; statuses: JobStatus[] }[] = [
  { id: "ready", label: "Ready", statuses: ["tailored"] },
  { id: "new", label: "New", statuses: ["new", "shortlisted", "tailor_queued"] },
  { id: "all", label: "All", statuses: GROUP_ORDER },
  { id: "applied", label: "Applied", statuses: ["applied", "interviewing", "offer"] },
  // not in the contract's four: keeps skipped, rejected and archived jobs reachable, as the old status filter did
  { id: "closed", label: "Closed", statuses: ["rejected", "expired", "skipped", "archived"] },
];
const TRACK_LABEL = { java: "Java backend", python: "Python backend", fullstack: "Full-stack JS" };
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName));

export default function Jobs() {
  useTitle("Jobs");
  const navigate = useNavigate();
  const { jobs, error, setStatus, replace } = useJobs();
  const tailor = useTailorNow(replace);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  // /jobs?q=Acme opens pre-filtered (the Contacts page links a company's open jobs this way)
  const [q, setQ] = useState(() => new URLSearchParams(window.location.search).get("q") ?? "");
  const [view, setView] = useState("all");
  const [track, setTrack] = useState("all");
  const [source, setSource] = useState("all");
  const [minScore, setMinScore] = useState(0);
  const [range, setRange] = useState(0); // all time, so "All" and the Board count the same jobs
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // per-viewer convenience: when this browser last opened the Jobs page
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

  const allSources = useMemo(() => [...new Set((jobs ?? []).flatMap((j) => j.job_links.map((l) => l.source)))].sort(), [jobs]);

  // everything but the view: the tabs count against this
  const filtered = useMemo(() => {
    const since = range ? Date.now() - range * 86400000 : 0;
    const needle = q.trim().toLowerCase();
    return (jobs ?? [])
      .filter((j) => track === "all" || j.track === track)
      .filter((j) => source === "all" || j.job_links.some((l) => l.source === source))
      .filter((j) => (j.llm_score ?? 0) >= minScore)
      .filter((j) => new Date(j.created_at).getTime() >= since)
      .filter((j) => !needle || `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(needle));
  }, [jobs, q, track, source, minScore, range]);

  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[0];
  const groups = useMemo(
    () =>
      GROUP_ORDER.filter((s) => current.statuses.includes(s))
        .map((status) => ({
          status,
          items: filtered
            .filter((j) => j.status === status)
            .sort((a, b) => (b.llm_score ?? -1) - (a.llm_score ?? -1) || b.created_at.localeCompare(a.created_at)),
        }))
        .filter((g) => g.items.length),
    [filtered, current],
  );
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => setCursor(-1), [view, q, track, source, minScore, range]);

  // keyboard triage: j/k move, Enter opens, t tailors, a applies, / searches, Esc clears
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector(".cmdk-overlay")) return;
      const job = flat[cursor];
      if (e.key === "j") setCursor((c) => Math.min(c + 1, flat.length - 1));
      else if (e.key === "k") setCursor((c) => Math.max(c - 1, 0));
      else if (e.key === "/") searchRef.current?.focus();
      else if (e.key === "Escape") setCursor(-1);
      else if (e.key === "Enter" && job && e.target === document.body) navigate(`/jobs/${job.id}`);
      else if (e.key === "t" && job && tailorPhase(job) !== "tailoring" && tailorPhase(job) !== "ready") tailor.start(job);
      else if (e.key === "a" && job?.apply_url && tailorPhase(job) === "ready") window.open(job.apply_url, "_blank", "noopener");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, cursor, navigate, tailor]);

  useEffect(() => {
    if (cursor < 0) return;
    listRef.current?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const lastRun = runs?.[0];
  const since = lastVisit ?? lastRun?.started_at ?? null;
  // after a visit: strictly newer; after a scan: everything that scan stored (stamped at or after its start)
  const newSince = jobs && since ? jobs.filter((j) => (lastVisit ? j.created_at > since : j.created_at >= since)).length : null;
  const activeFilters = [range !== 0, track !== "all", source !== "all", minScore > 0].filter(Boolean).length;
  const flash = balances.find((b) => b.provider === "gemini:gemini-flash-latest");
  const next = nextScan();
  let index = -1;

  return (
    <>
      <div className="bar">
        <h1>Jobs</h1>
        <div className="tabs" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.id} aria-pressed={view === v.id} onClick={() => setView(v.id)}>
              {v.label}
              <span className="count">{jobs ? filtered.filter((j) => v.statuses.includes(j.status)).length : ""}</span>
            </button>
          ))}
        </div>
        <span className="spacer" />
        <MetaLine
          label="Scan status"
          cells={[
            { term: "Last scan", value: lastRun ? istDateTime(lastRun.started_at) : runs ? "none yet" : "…" },
            { term: lastVisit ? "New since last visit" : "New from last scan", value: newSince ?? "…" },
            { term: "Resumes left today", value: flash ? `${flash.remaining ?? "?"}/${flash.limit_value ?? "?"}` : "–" },
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
        <label className="grow">
          <span className="visually-hidden">Search</span>
          <Search {...ICON} size={14} />
          <input ref={searchRef} type="search" placeholder="Search title, company or city  ( / )" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button type="button" className="btn small" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
          <SlidersHorizontal {...ICON} size={14} />
          Filters{activeFilters ? ` · ${activeFilters}` : ""}
        </button>
        <div className="chips" aria-label="Active filters">
          {range !== 0 && (
            <span className="chip">
              {RANGES.find((r) => r.days === range)?.label}
              <button aria-label="Show jobs from all time" onClick={() => setRange(0)}>
                <X {...ICON} size={12} />
              </button>
            </span>
          )}
          {track !== "all" && (
            <span className="chip">
              {(TRACK_LABEL as Record<string, string>)[track] ?? track}
              <button aria-label="Every track" onClick={() => setTrack("all")}>
                <X {...ICON} size={12} />
              </button>
            </span>
          )}
          {source !== "all" && (
            <span className="chip">
              {sourceLabel(source)}
              <button aria-label="Every source" onClick={() => setSource("all")}>
                <X {...ICON} size={12} />
              </button>
            </span>
          )}
          {minScore > 0 && (
            <span className="chip">
              Match ≥ {minScore}
              <button aria-label="Any match score" onClick={() => setMinScore(0)}>
                <X {...ICON} size={12} />
              </button>
            </span>
          )}
        </div>
        <div className="more">
          <select value={range} onChange={(e) => setRange(Number(e.target.value))} aria-label="Found within">
            {RANGES.map((r) => (
              <option key={r.days} value={r.days}>
                {r.label}
              </option>
            ))}
          </select>
          <select value={track} onChange={(e) => setTrack(e.target.value)} aria-label="Track">
            <option value="all">Every track</option>
            {Object.entries(TRACK_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
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
            Match ≥
            <input type="number" min={0} max={100} step={5} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} style={{ width: 64 }} />
          </label>
        </div>
      </div>

      <div className="list" ref={listRef} role="list" aria-label="Jobs">
        {!jobs &&
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="jrow" aria-hidden>
              <span className="skeleton" style={{ width: 14, height: 14, borderRadius: 7 }} />
              <span className="skeleton" style={{ width: 28 }} />
              <span className="skeleton" style={{ width: `${45 + ((i * 11) % 35)}%` }} />
            </div>
          ))}
        {groups.map((g) => (
          <div className="group" key={g.status} role="presentation">
            <div className="group-head">
              <StatusIcon status={g.status} />
              {STATUS_LABEL[g.status]}
              <span className="count">{g.items.length}</span>
            </div>
            {g.items.map((j: Job) => {
              index += 1;
              const i = index;
              const ready = tailorPhase(j) === "ready";
              return (
                <Fragment key={j.id}>
                  <div className={`jrow${cursor === i ? " cursor" : ""}`} data-row={i} role="listitem" onMouseDown={() => setCursor(i)}>
                    <div className="c-status">
                      <StatusSelect status={j.status} onChange={(s) => setStatus(j.id, s)} label={`Status of ${j.title} at ${j.company}`} />
                    </div>
                    <div className="c-scores">
                      <span className="c-match">
                        <MatchScore score={j.llm_score} reason={j.score_reason} />
                      </span>
                    </div>
                    <div className="title-cell">
                      <div className="title-line">
                        <Link className="role-title" to={`/jobs/${j.id}`}>
                          {j.title}
                        </Link>
                      </div>
                      <div className="role-sub">
                        <EvalFlags job={j} />
                        <span className="clip">
                          {j.company} · {j.remote ? "Remote" : j.city ?? j.location}
                        </span>
                      </div>
                    </div>
                    <div className="c-meta">
                      <span className="c-sources">
                        <SourceBadges links={j.job_links} />
                      </span>
                      <span className="c-ats">
                        <AtsScore pill score={j.ats_score ?? j.tailorings[0]?.ats_score} />
                      </span>
                      <span className="c-age age">{ago(j.created_at)}</span>
                    </div>
                    <div className="act">
                      <ResumeAction job={j} onTailor={tailor.start} busy={tailor.busy === j.id} />
                      {ready && <ApplyLink url={j.apply_url} primary={cursor === i} />}
                    </div>
                  </div>
                </Fragment>
              );
            })}
          </div>
        ))}
        {jobs && jobs.length === 0 && (
          <Empty
            title="No jobs yet"
            action={
              <Link to="/add" className="btn">
                <Plus {...ICON} size={14} />
                Add a job by hand
              </Link>
            }
          >
            The first scan runs at {istTime(next)} IST and fills this list with scored matches. You can also paste a job description now and tailor a
            resume for it.
          </Empty>
        )}
        {jobs && jobs.length > 0 && flat.length === 0 && (
          <Empty title="Nothing in this view">Pick another tab, widen the time range, or lower the match score.</Empty>
        )}
      </div>
      <div className="shortcuts" aria-hidden>
        <span>
          <kbd>j</kbd>
          <kbd>k</kbd> move
        </span>
        <span>
          <kbd aria-label="Enter">
            <CornerDownLeft {...ICON} size={11} />
          </kbd>{" "}
          open
        </span>
        <span>
          <kbd>t</kbd> tailor
        </span>
        <span>
          <kbd>a</kbd> apply
        </span>
        <span>
          <kbd>/</kbd> search
        </span>
        <span>
          <kbd>{MAC ? "⌘" : "Ctrl"}</kbd>
          <kbd>K</kbd> command menu
        </span>
      </div>
    </>
  );
}
