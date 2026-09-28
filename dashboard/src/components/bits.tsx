import { AlertTriangle, ExternalLink, FileText, Wand2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { ago, sourceLabel } from "../lib/format";
import { tailorPhase } from "../lib/tailor";
import { ATS_MINIMUM, STATUS_LABEL, type Job, type JobLink, type JobStatus } from "../lib/types";

export const ICON = { size: 16, strokeWidth: 1.75, className: "icon", "aria-hidden": true } as const;

export function StatusMark({ status }: { status: JobStatus }) {
  return (
    <span className="status">
      <span className={`mark m-${status}`} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Match score from the scan (how well the job fits your profile). */
export function MatchScore({ score, reason }: { score: number | null; reason?: string | null }) {
  if (score == null) return <span className="score none" title="Not scored yet">–</span>;
  return (
    <span className="score" title={reason ? `Match ${score}/100: ${reason}` : `Match ${score}/100`}>
      {score}
    </span>
  );
}

/** ATS score of the tailored resume, read against the 80 minimum and the target. */
export function AtsScore({ score, target = 90, withLabel = false }: { score: number | null | undefined; target?: number; withLabel?: boolean }) {
  if (score == null) return <span className="score none" title="No tailored resume yet">–</span>;
  const cls = score >= target ? "in-target" : score >= ATS_MINIMUM ? "in-tol" : "out";
  const label = score >= target ? "on target" : score >= ATS_MINIMUM ? "above minimum" : "below 80";
  return (
    <span className={`ats ${cls}`} title={`ATS ${score}/100, ${label}`}>
      {score}
      {withLabel && <span className="small">{label}</span>}
    </span>
  );
}

export function SourceTags({ links }: { links: JobLink[] }) {
  const seen = new Map<string, string>();
  for (const l of links) if (!seen.has(l.source)) seen.set(l.source, l.url);
  return (
    <span className="tags">
      {[...seen].map(([source, url]) =>
        url ? (
          <a key={source} className="tag" href={url} target="_blank" rel="noreferrer" title={`Open on ${sourceLabel(source)}`}>
            {sourceLabel(source)}
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
        <FileText {...ICON} />
        {busy ? "Opening…" : label}
      </button>
      {error && <span className="error-text">{error}</span>}
    </>
  );
}

export function ApplyLink({ url, primary = false }: { url: string | null; primary?: boolean }) {
  if (!url) return null;
  return (
    <a className={`btn small${primary ? " primary" : ""}`} href={url} target="_blank" rel="noreferrer">
      Apply
      <ExternalLink {...ICON} size={14} />
    </a>
  );
}

/** The next thing to do with a job's resume: tailor it, wait for it, or open it. */
export function ResumeAction({
  job,
  onTailor,
  busy,
  compact = true,
}: {
  job: Job;
  onTailor: (job: Job) => void;
  busy: boolean;
  compact?: boolean;
}) {
  const phase = tailorPhase(job);
  const size = compact ? " small" : "";
  if (phase === "tailoring")
    return (
      <span className="working" title="The GitHub Action usually takes about 3 minutes">
        Tailoring, started {ago(job.tailor_requested_at)}
      </span>
    );
  if (phase === "ready" && job.tailorings[0]?.pdf_path) return <PdfButton path={job.tailorings[0].pdf_path} small={compact} />;
  return (
    <button
      className={`btn act${size}`}
      onClick={() => onTailor(job)}
      disabled={busy}
      aria-busy={busy}
      title={phase === "queued" ? "Queued for the next scan; start it now instead (about 3 minutes)" : "Tailor a resume now (about 3 minutes)"}
    >
      <Wand2 {...ICON} />
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
      <span style={{ width: `${Math.max(ratio * 100, 1.5)}%` }} />
    </div>
  );
}

export function LowFlag() {
  return (
    <span className="tag bad" title="Less than 20% left">
      <AlertTriangle {...ICON} size={14} />
      Low
    </span>
  );
}

export function TitleBlock({
  cells,
  label,
  corner = false,
}: {
  cells: { term: string; value: ReactNode; sub?: ReactNode }[];
  label: string;
  /** set into the sheet frame's top-right corner, as on a drawing */
  corner?: boolean;
}) {
  return (
    <dl className={`titleblock${corner ? " corner" : ""}`} aria-label={label}>
      {cells.map((c) => (
        <div key={c.term}>
          <dt>{c.term}</dt>
          <dd>
            {c.value} {c.sub && <span className="small">{c.sub}</span>}
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

/** Balloon: a drawing's item number, tying a mark on the chain to its row in the parts list. */
export function Balloon({ n }: { n: number }) {
  return (
    <span className="balloon" aria-hidden>
      {n}
    </span>
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
