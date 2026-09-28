import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ago } from "../lib/format";
import { tailorPhase } from "../lib/tailor";
import { ATS_MINIMUM, ATS_PARTS, type AtsDetail, type Job } from "../lib/types";
import { Balloon, Empty, ICON, ResumeAction } from "./bits";

const pct = (n: number) => `${Math.max(0, Math.min(100, n))}%`;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function verdict(ats: AtsDetail): { text: string; cls: string } {
  if (ats.score >= ats.target) return { text: `On target (${ats.target}+)`, cls: "good" };
  if (ats.score >= ATS_MINIMUM) return { text: `Above the ${ATS_MINIMUM} minimum, under the ${ats.target} target`, cls: "" };
  return { text: `Below the ${ATS_MINIMUM} minimum`, cls: "bad" };
}

/** True the first time this browser shows a given resume's score: the dimension line draws once, not on every visit. */
function useFirstSight(key: string): boolean {
  const storageKey = `ats-drawn:${key}`;
  const [first] = useState(() => {
    try {
      return !localStorage.getItem(storageKey);
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, "1");
    } catch {
      /* storage unavailable: the line simply stays drawn */
    }
  }, [storageKey]);
  return first;
}

/** The total drawn as a dimension line over the chain of parts, each part hatched as far as it scored. */
function DimensionChain({ ats, drawKey }: { ats: AtsDetail; drawKey: string }) {
  const best = Math.max(ats.max_achievable, ats.score);
  const draw = useFirstSight(drawKey);
  return (
    <div className="chain" role="img" aria-label={`ATS ${ats.score} of 100; best honest score ${best}; minimum ${ATS_MINIMUM}, target ${ats.target}`}>
      <div className="chain-dim" aria-hidden>
        <span className="value" style={{ left: pct(ats.score / 2) }}>
          {ats.score}
        </span>
        <span className={`line${draw ? " draw" : ""}`} style={{ width: pct(ats.score) }} />
        {best > ats.score && (
          <>
            <span className="hidden" style={{ left: pct(ats.score), width: pct(best - ats.score) }} />
            <span className="hidden-label" style={{ left: pct(best) }}>
              best honest {best}
            </span>
          </>
        )}
      </div>
      <div className="chain-bar" aria-hidden>
        {ATS_PARTS.map((p) => {
          const part = ats.breakdown[p.key];
          if (!part) return null;
          const reach = Math.max(ats.reach?.[p.key] ?? part.points, part.points);
          return (
            <div key={p.key} className="chain-seg" style={{ width: pct(part.max) }} title={`${p.label}: ${fmt(part.points)} of ${part.max}`}>
              <span className="earned" style={{ width: pct((part.points / part.max) * 100) }} />
              {reach > part.points && (
                <span
                  className="reach"
                  style={{ left: pct((part.points / part.max) * 100), width: pct(((reach - part.points) / part.max) * 100) }}
                />
              )}
            </div>
          );
        })}
        {[ATS_MINIMUM, ats.target].map((ref) => (
          <span key={ref} className={`chain-ref${ref === ats.target ? " target" : ""}`} style={{ left: pct(ref) }} />
        ))}
      </div>
      <div className="chain-labels" aria-hidden>
        {ATS_PARTS.map((p, i) => {
          const part = ats.breakdown[p.key];
          if (!part) return null;
          return (
            <div key={p.key} style={{ width: pct(part.max) }} title={`${p.label}: ${fmt(part.points)} of ${part.max}`}>
              <Balloon n={i + 1} />
              <span className="lbl">{p.short}</span>
              <span className="val">
                {fmt(part.points)}/{part.max}
              </span>
            </div>
          );
        })}
      </div>
      <div className="chain-legend">
        <span>
          <span className="k k-earned" />
          Earned
        </span>
        <span>
          <span className="k k-reach" />
          Your profile can still add
        </span>
        <span>
          <span className="k k-target" />
          {ATS_MINIMUM} minimum and {ats.target} target
        </span>
        <span>Empty: not in your profile</span>
      </div>
    </div>
  );
}

function Keywords({ ats }: { ats: AtsDetail }) {
  const matched = [...ats.matched_required, ...ats.matched_preferred];
  return (
    <div className="kw-groups">
      <div>
        <h3>On this resume ({matched.length})</h3>
        <div className="tags">
          {matched.map((k) => (
            <span className="tag ok" key={k}>
              <Check {...ICON} size={14} />
              {k}
              {ats.matched_preferred.includes(k) && <span className="muted">preferred</span>}
            </span>
          ))}
          {!matched.length && <span className="muted small">None of the job's keywords were found.</span>}
        </div>
      </div>
      {!!ats.missing_fixable.length && (
        <div>
          <h3>In your profile, not on this resume yet ({ats.missing_fixable.length})</h3>
          <div className="tags">
            {ats.missing_fixable.map((k) => (
              <span className="tag fixable" key={k}>
                {k}
              </span>
            ))}
          </div>
          <p className="muted small" style={{ marginTop: 6 }}>
            Tailor again to work these in; they count as soon as the resume says them.
          </p>
        </div>
      )}
      {!!ats.missing_gaps.length && (
        <div>
          <h3>Not in your profile ({ats.missing_gaps.length})</h3>
          <div className="tags">
            {ats.missing_gaps.map((k) => (
              <Link className="tag hidden-line" key={k} to={`/skills#${encodeURIComponent(k.toLowerCase())}`}>
                {k}
              </Link>
            ))}
          </div>
          <p className="muted small" style={{ marginTop: 6 }}>
            Never added to a resume. They are listed on the Skills page, ranked by how many jobs ask for them.
          </p>
        </div>
      )}
    </div>
  );
}

function Rounds({ rounds }: { rounds: number[] }) {
  const kept = rounds.indexOf(Math.max(...rounds));
  return (
    <table className="small" aria-label="Revision rounds">
      <thead>
        <tr>
          <th>Revision</th>
          <th className="right">ATS</th>
          <th className="right">Change</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rounds.map((r, i) => (
          <tr key={i}>
            <td>{i === 0 ? "R0 first draft" : `R${i}`}</td>
            <td className="right num">{r}</td>
            <td className="right num">{i === 0 ? "–" : `${r - rounds[i - 1] >= 0 ? "+" : ""}${r - rounds[i - 1]}`}</td>
            <td className="muted">{i === kept ? "kept" : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AtsPanel({
  job,
  have,
  onTailor,
  busy,
}: {
  job: Job;
  /** lower-cased skills you can claim: profile plus "I know this" */
  have: Set<string>;
  onTailor: (job: Job) => void;
  busy: boolean;
}) {
  const t = job.tailorings[0];
  const ats = t?.ats ?? null;
  const phase = tailorPhase(job);

  if (!ats) {
    const req = job.jd_keywords?.required ?? [];
    const pref = job.jd_keywords?.preferred ?? [];
    return (
      <section className="panel" aria-labelledby="ats-h">
        <div className="panel-pad">
          <h2 id="ats-h">ATS score</h2>
        </div>
        <Empty
          title={phase === "tailoring" ? "Tailoring now" : "No tailored resume yet"}
          action={phase === "tailoring" ? undefined : <ResumeAction job={job} onTailor={onTailor} busy={busy} compact={false} />}
        >
          {phase === "tailoring"
            ? `Started ${ago(job.tailor_requested_at)}. The resume and its ATS score appear here in about 3 minutes; this page checks for it.`
            : "Tailor now builds a one-page resume for this job from your profile, scores it the way a keyword ATS reads it, and revises it toward 90."}
        </Empty>
        {!!(req.length || pref.length) && (
          <div className="panel-pad" style={{ borderTop: "1px solid var(--rule)" }}>
            <h3 className="small soft" style={{ marginBottom: 8 }}>
              What this job asks for
            </h3>
            <div className="tags">
              {[...req, ...pref].map((k) => {
                const ok = have.has(k.toLowerCase());
                return (
                  <span key={k} className={`tag${ok ? " ok" : " hidden-line"}`} title={ok ? "In your profile" : "Not in your profile"}>
                    {ok && <Check {...ICON} size={14} />}
                    {k}
                    {pref.includes(k) && <span className="muted">preferred</span>}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </section>
    );
  }

  const v = verdict(ats);
  const best = Math.max(ats.max_achievable, ats.score);
  return (
    <section className="panel panel-pad" aria-labelledby="ats-h">
      <div className="ats-head">
        <div>
          <h2 id="ats-h">ATS score</h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            Read from the compiled PDF's text, the way a keyword ATS reads it.
          </p>
        </div>
        <div className="ats-figure">
          <span className="big">{ats.score}</span>
          <span className="muted">/ 100</span>
          <span className={`ats-verdict ${v.cls}`}>{v.text}</span>
        </div>
      </div>

      {best < ATS_MINIMUM && (
        <div className="notice" style={{ marginBottom: 12 }}>
          <div>
            The best honest score for this job is <strong>{best}</strong>, under the {ATS_MINIMUM} minimum. It is held back by{" "}
            {ats.missing_gaps.slice(0, 4).join(", ")}, which your profile does not list.
          </div>
        </div>
      )}

      <DimensionChain ats={ats} drawKey={t?.id ?? job.id} />

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table className="small" aria-label="ATS score parts">
          <thead>
            <tr>
              <th>Part</th>
              <th className="right">Earned</th>
              <th className="right">Best honest</th>
              <th className="hide-sm">What decides it</th>
            </tr>
          </thead>
          <tbody>
            {ATS_PARTS.map((p, i) => {
              const part = ats.breakdown[p.key];
              if (!part) return null;
              const reach = Math.max(ats.reach?.[p.key] ?? part.points, part.points);
              return (
                <tr key={p.key}>
                  <td>
                    <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                      <Balloon n={i + 1} />
                      {p.label}
                    </span>
                    <div className="only-narrow muted">{part.note}</div>
                  </td>
                  <td className="right num">
                    {fmt(part.points)} <span className="muted">/ {part.max}</span>
                  </td>
                  <td className="right num">{reach > part.points ? fmt(reach) : <span className="muted">same</span>}</td>
                  <td className="soft hide-sm">
                    {part.note}
                    {p.key === "placement" && ats.skills_only.length > 0 && `: ${ats.skills_only.join(", ")}`}
                    {p.key === "title" && ats.best_title && reach > part.points && `; best allowed headline: ${ats.best_title}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Keywords ats={ats} />

      {!!ats.rounds && ats.rounds.length > 1 && (
        <div style={{ marginTop: 20 }}>
          <h3 className="small soft" style={{ marginBottom: 6 }}>
            Revisions: the highest-scoring honest version is kept
          </h3>
          <Rounds rounds={ats.rounds} />
        </div>
      )}
    </section>
  );
}
