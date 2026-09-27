import { useState } from "react";
import { api } from "../lib/api";
import { sourceLabel } from "../lib/format";
import { STATUS_LABEL, type JobLink, type JobStatus } from "../lib/types";

const STATUS_DOT: Record<JobStatus, string> = {
  new: "var(--series-1)",
  shortlisted: "var(--series-1)",
  tailor_queued: "var(--warning)",
  tailored: "var(--series-3)",
  applied: "var(--good)",
  interviewing: "var(--good)",
  offer: "var(--good)",
  rejected: "var(--critical)",
  skipped: "var(--axis)",
  archived: "var(--axis)",
};

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className="status">
      <span className="dot" style={{ background: STATUS_DOT[status] }} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="score lo" title="Not scored yet">–</span>;
  const cls = score >= 80 ? "hi" : score >= 65 ? "mid" : "lo";
  return (
    <span className={`score ${cls}`} title="LLM match score out of 100">
      {score}
    </span>
  );
}

export function SourceBadges({ links }: { links: JobLink[] }) {
  const seen = new Map<string, string>();
  for (const l of links) if (!seen.has(l.source)) seen.set(l.source, l.url);
  return (
    <span className="row" style={{ gap: 4 }}>
      {[...seen].map(([source, url]) => (
        <a key={source} className="chip" href={url} target="_blank" rel="noreferrer" title={`Open on ${sourceLabel(source)}`}>
          {sourceLabel(source)}
        </a>
      ))}
    </span>
  );
}

export function PdfLink({ path, label = "PDF" }: { path: string | null; label?: string }) {
  const [busy, setBusy] = useState(false);
  if (!path) return null;
  return (
    <button
      className="btn small"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          window.open(await api.signedUrl(path), "_blank", "noopener");
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </button>
  );
}

/** Meter: fill carries severity, the track is a lighter step of the same family. */
export function Meter({ used, limit }: { used: number; limit: number | null }) {
  if (!limit) return <span className="muted">no limit</span>;
  const ratio = Math.min(used / limit, 1);
  const left = 1 - ratio;
  const [fill, track] =
    left < 0.2
      ? ["var(--critical)", "var(--track-critical)"]
      : left < 0.4
        ? ["var(--warning)", "var(--track-warning)"]
        : ["var(--good)", "var(--track-good)"];
  return (
    <div
      className="meter"
      style={{ background: track }}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={used}
      aria-label={`${Math.round(ratio * 100)}% used`}
    >
      <span style={{ width: `${Math.max(ratio * 100, 2)}%`, background: fill }} />
    </div>
  );
}

export function LowFlag() {
  return (
    <span className="chip" style={{ color: "var(--critical-ink)" }} title="Less than 20% left">
      ⚠ Low
    </span>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
