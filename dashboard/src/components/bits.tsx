import { AlertTriangle, Ban, ExternalLink, FileText, ShieldAlert, Wand2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { ago, sourceLabel } from "../lib/format";
import { tailorPhase } from "../lib/tailor";
import { ATS_MINIMUM, STATUS_LABEL, STATUSES, type Job, type JobLink, type JobStatus } from "../lib/types";

export const ICON = { size: 16, strokeWidth: 1.75, className: "icon", "aria-hidden": true } as const;

/** The Fairsheet mark: a violet tile with a sheet's ruled lines and a check. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect width="24" height="24" rx="6" fill="var(--accent)" />
      <rect x="0.5" y="0.5" width="23" height="23" rx="5.5" fill="none" stroke="rgb(255 255 255 / 0.18)" />
      <path d="M6.5 7.5h11M6.5 11.5h6" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M11.5 16.2l2.3 2.3 4.7-5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Progress circles: each status is a step further round the ring, as in an issue tracker's workflow.
const RING: Record<JobStatus, { color: string; fill: number; kind: "dash" | "ring" | "done" | "stop" }> = {
  new: { color: "var(--text-3)", fill: 0, kind: "dash" },
  shortlisted: { color: "var(--text-2)", fill: 0, kind: "ring" },
  tailor_queued: { color: "var(--warn)", fill: 0.5, kind: "ring" },
  tailored: { color: "var(--good)", fill: 0.75, kind: "ring" },
  applied: { color: "var(--accent-text)", fill: 1, kind: "done" },
  interviewing: { color: "var(--info)", fill: 1, kind: "done" },
  offer: { color: "var(--good)", fill: 1, kind: "done" },
  rejected: { color: "var(--bad)", fill: 1, kind: "stop" },
  skipped: { color: "var(--text-3)", fill: 0, kind: "stop" },
  archived: { color: "var(--text-3)", fill: 0, kind: "stop" },
};

export function StatusIcon({ status, size = 14 }: { status: JobStatus; size?: number }) {
  const { color, fill, kind } = RING[status];
  const r = 3.5;
  const a = fill * 2 * Math.PI;
  const x = 7 + r * Math.sin(a);
  const y = 7 - r * Math.cos(a);
  const pie = fill > 0 && fill < 1 ? `M7 7 L7 ${7 - r} A${r} ${r} 0 ${fill > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z` : "";
  return (
    <svg className="sicon" width={size} height={size} viewBox="0 0 14 14" aria-hidden style={{ color }}>
      {kind === "dash" && <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 2.1" />}
      {kind === "ring" && (
        <>
          <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          {pie && <path d={pie} fill="currentColor" />}
        </>
      )}
      {kind === "done" && (
        <>
          <circle cx="7" cy="7" r="7" fill="currentColor" />
          {status === "interviewing" ? (
            <circle cx="7" cy="7" r="2.4" fill="var(--bg)" />
          ) : (
            <path d="M4.3 7.2l1.8 1.8 3.7-4" fill="none" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </>
      )}
      {kind === "stop" && (
        <>
          <circle cx="7" cy="7" r="6" fill={status === "rejected" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" />
          <path
            d={status === "rejected" ? "M5 5l4 4M9 5l-4 4" : "M4.2 9.8l5.6-5.6"}
            stroke={status === "rejected" ? "var(--bg)" : "currentColor"}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

export function StatusMark({ status }: { status: JobStatus }) {
  return (
    <span className="status">
      <StatusIcon status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** The status icon is the control: a native select laid over it keeps keyboard and screen-reader behaviour. */
export function StatusSelect({
  status,
  onChange,
  label,
  showLabel = false,
}: {
  status: JobStatus;
  onChange: (s: JobStatus) => void;
  label: string;
  showLabel?: boolean;
}) {
  return (
    <span className="status-select" title={STATUS_LABEL[status]}>
      <StatusIcon status={status} />
      {showLabel && STATUS_LABEL[status]}
      <select value={status} onChange={(e) => onChange(e.target.value as JobStatus)} aria-label={label}>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Match score from the scan (how well the job fits your profile). */
export function MatchScore({ score, reason, pill = true }: { score: number | null; reason?: string | null; pill?: boolean }) {
  if (score == null) return <span className={`score none${pill ? " pill match" : ""}`} title="Not scored yet">–</span>;
  return (
    <span className={`score${pill ? ` pill match${score >= 85 ? " hi" : ""}` : ""}`} title={reason ? `Match ${score}/100: ${reason}` : `Match ${score}/100`}>
      {score}
    </span>
  );
}

/** ATS score of the tailored resume, read against the 80 minimum and the target. */
export function AtsScore({
  score,
  target = 90,
  withLabel = false,
  pill = false,
}: {
  score: number | null | undefined;
  target?: number;
  withLabel?: boolean;
  pill?: boolean;
}) {
  if (score == null)
    return (
      <span className={`ats none${pill ? " pill" : ""}`} title="No tailored resume yet">
        {pill ? "ATS –" : "–"}
      </span>
    );
  const cls = score >= target ? "in-target" : score >= ATS_MINIMUM ? "in-tol" : "out";
  const label = score >= target ? "on target" : score >= ATS_MINIMUM ? "above minimum" : "below 80";
  return (
    <span className={`ats ${cls}${pill ? " pill" : ""}`} title={`ATS ${score}/100, ${label}`}>
      {pill && <span className="muted">ATS</span>}
      {score}
      {withLabel && <span className="small">{label}</span>}
    </span>
  );
}

function uniqueSources(links: JobLink[]): [string, string][] {
  const seen = new Map<string, string>();
  for (const l of links) if (!seen.has(l.source)) seen.set(l.source, l.url);
  return [...seen];
}

export function SourceTags({ links }: { links: JobLink[] }) {
  return (
    <span className="tags">
      {uniqueSources(links).map(([source, url]) =>
        url ? (
          <a key={source} className="tag" href={url} target="_blank" rel="noreferrer" title={`Open on ${sourceLabel(source)}`}>
            {sourceLabel(source)}
            <ExternalLink {...ICON} size={12} />
          </a>
        ) : (
          <span key={source} className="tag">
            {sourceLabel(source)}
          </span>
        ),
      )}
    </span>
  );
}

/** Compact source badges for list rows: the first letter of each board, linked. */
export function SourceBadges({ links, max = 3 }: { links: JobLink[]; max?: number }) {
  const all = uniqueSources(links);
  return (
    <span className="sources">
      {all.slice(0, max).map(([source, url]) => (
        <a key={source} className="src" href={url || undefined} target="_blank" rel="noreferrer" title={sourceLabel(source)} aria-label={`Open on ${sourceLabel(source)}`}>
          {sourceLabel(source).slice(0, 1)}
        </a>
      ))}
      {all.length > max && <span className="src" title={all.slice(max).map(([s]) => sourceLabel(s)).join(", ")}>+{all.length - max}</span>}
    </span>
  );
}

export function PdfButton({ path, label = "Resume", small = true }: { path: string | null; label?: string; small?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!path) return null;
  return (
    <>
      <button
        className={`btn${small ? " small" : ""}`}
        aria-busy={busy}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            window.open(await api.signedUrl(path), "_blank", "noopener");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <FileText {...ICON} size={14} />
        {busy ? "Opening…" : label}
      </button>
      {error && <span className="error-text">{error}</span>}
    </>
  );
}

export function ApplyLink({ url, primary = false, className = "" }: { url: string | null; primary?: boolean; className?: string }) {
  if (!url) return null;
  return (
    <a className={`btn small${primary ? " primary" : ""} ${className}`.trim()} href={url} target="_blank" rel="noreferrer">
      Apply
      <ExternalLink {...ICON} size={13} />
    </a>
  );
}

/** The next thing to do with a job's resume: tailor it, wait for it, or open it. */
export function ResumeAction({
  job,
  onTailor,
  busy,
  compact = true,
  className = "",
}: {
  job: Job;
  onTailor: (job: Job) => void;
  busy: boolean;
  compact?: boolean;
  className?: string;
}) {
  const phase = tailorPhase(job);
  const size = compact ? " small" : "";
  if (phase === "tailoring")
    return (
      <span className="working" title="The GitHub Action usually takes about 3 minutes">
        Tailoring · {ago(job.tailor_requested_at)}
      </span>
    );
  if (phase === "ready" && job.tailorings[0]?.pdf_path)
    return (
      <span className={className}>
        <PdfButton path={job.tailorings[0].pdf_path} small={compact} />
      </span>
    );
  return (
    <button
      className={`btn act${size} ${className}`.trim()}
      onClick={() => onTailor(job)}
      disabled={busy}
      aria-busy={busy}
      title={phase === "queued" ? "Queued for the next scan; start it now instead (about 3 minutes)" : "Tailor a resume now (about 3 minutes)"}
    >
      <Wand2 {...ICON} size={14} />
      {busy ? "Starting…" : "Tailor now"}
    </button>
  );
}

export function Meter({ used, limit, label }: { used: number; limit: number | null; label: string }) {
  if (!limit) return <span className="muted small">no limit</span>;
  const ratio = Math.min(used / limit, 1);
  const left = 1 - ratio;
  const cls = left < 0.2 ? "low" : left < 0.4 ? "mid" : "";
  return (
    <div
      className={`meter ${cls}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={used}
      aria-label={`${label}: ${Math.round(ratio * 100)}% used`}
    >
      <span style={{ width: `${Math.max(ratio * 100, 2)}%` }} />
    </div>
  );
}

export const VERDICT_LABEL = { apply: "Worth applying", maybe: "Could go either way", skip: "Do not apply" } as const;
export const LEGITIMACY_LABEL = {
  high: "Looks like a real, open role",
  caution: "Check it is still open",
  suspicious: "Suspicious posting",
} as const;

/** Row flags from the evaluation, on the company line: only the two that should stop you, so ordinary rows stay quiet. */
export function EvalFlags({ job }: { job: Job }) {
  const stops = job.hard_stops ?? [];
  const signals = job.legitimacy_signals ?? [];
  return (
    <>
      {job.verdict === "skip" && (
        <span className="flag bad" title={stops.length ? stops.join("; ") : "The evaluation says this role is not worth an application"}>
          <Ban {...ICON} size={12} />
          Do not apply
        </span>
      )}
      {job.legitimacy === "suspicious" && (
        <span className="flag warn" title={signals.join("; ") || LEGITIMACY_LABEL.suspicious}>
          <ShieldAlert {...ICON} size={12} />
          Check posting
        </span>
      )}
    </>
  );
}

export function LowFlag() {
  return (
    <span className="tag bad" title="Less than 20% left">
      <AlertTriangle {...ICON} size={13} />
      Low
    </span>
  );
}

/** A line of small facts (scan status and the like), read left to right. */
export function MetaLine({ cells, label }: { cells: { term: string; value: ReactNode; sub?: ReactNode }[]; label: string }) {
  return (
    <dl className="metaline" aria-label={label}>
      {cells.map((c) => (
        <div key={c.term}>
          <dt>{c.term}</dt>
          <dd>
            {c.value} {c.sub && <span className="xs">{c.sub}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function SkeletonRows({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="skel-row" aria-hidden>
          {Array.from({ length: cols }, (_, c) => (
            <td key={c}>
              <span className="skeleton" style={{ width: c === 1 ? `${60 + ((r * 7) % 30)}%` : "60%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function Notice({
  kind = "info",
  children,
  onClose,
}: {
  kind?: "info" | "ok" | "error" | "pending";
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className={`notice ${kind === "info" ? "" : kind}`} role={kind === "error" ? "alert" : "status"}>
      {kind === "error" && <AlertTriangle {...ICON} />}
      <div style={{ flex: 1 }}>{children}</div>
      {onClose && (
        <button className="btn quiet small" onClick={onClose}>
          Dismiss
        </button>
      )}
    </div>
  );
}
