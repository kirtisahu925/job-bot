import { ArrowRight, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ago } from "../lib/format";
import { tailorPhase } from "../lib/tailor";
import { ATS_MINIMUM, ATS_PARTS, type AtsDetail, type Job } from "../lib/types";
import { Empty, ICON, ResumeAction } from "./bits";

const pct = (n: number) => `${Math.max(0, Math.min(100, n))}%`;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function verdict(ats: AtsDetail): { text: string; cls: string } {
  if (ats.score >= ats.target) return { text: `On target · ${ats.target}+`, cls: "in-target" };
  if (ats.score >= ATS_MINIMUM) return { text: `Above ${ATS_MINIMUM}, under the ${ats.target} target`, cls: "in-tol" };
  return { text: `Below the ${ATS_MINIMUM} minimum`, cls: "out" };
}

/** True the first time this browser shows a given resume's score: the bar fills once, not on every visit. */
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
      /* storage unavailable: the bar simply stays filled */
    }
  }, [storageKey]);
  return first;
}

/** The score on a true 0-100 scale: earned points packed from the left, one hairline between parts, then the
 * points your profile could still add (hatched), then what no honest resume can reach (empty track). */
function ScoreBar({ ats, drawKey }: { ats: AtsDetail; drawKey: string }) {
  const best = Math.max(ats.max_achievable, ats.score);
  const fill = useFirstSight(drawKey);
  const parts = ATS_PARTS.map((p) => ({ ...p, part: ats.breakdown[p.key] })).filter((p) => p.part && p.part.points > 0);
  return (
    <div className="scorebar" role="img" aria-label={`ATS ${ats.score} of 100; best honest score ${best}; minimum ${ATS_MINIMUM}, target ${ats.target}`}>
      <div className="scorebar-scale">
        <div className="scorebar-track" aria-hidden>
          <div className={`earned-wrap${fill ? " fill" : ""}`} style={{ width: pct(ats.score) }}>
            {parts.map((p) => (
              <span
                key={p.key}
                className="scorebar-part"
                style={{ flex: `${p.part.points} 0 0` }}
                title={`${p.label}: ${fmt(p.part.points)} of ${p.part.max}`}
              />
            ))}
          </div>
          {best > ats.score && <span className="scorebar-ghost" style={{ width: pct(best - ats.score) }} />}
        </div>
        {[ATS_MINIMUM, ats.target].map((ref) => (
          <span key={ref} className={`scorebar-ref${ref === ats.target ? " target" : ""}`} style={{ left: pct(ref) }} aria-hidden>
            <span>{ref === ats.target ? `target ${ref}` : `min ${ref}`}</span>
          </span>
        ))}
      </div>
      <div className="scorebar-legend">
        <span>
          <span className="k k-earned" />
          Earned {ats.score}
        </span>
        {best > ats.score && (
          <span>
            <span className="k k-reach" />
            Your profile can add {fmt(best - ats.score)} (best honest {best})
          </span>
        )}
        <span>
          <span className="k k-empty" />
          Not in your profile
        </span>
        <span>
          <span className="k k-ref" />
          {ATS_MINIMUM} minimum, {ats.target} target
        </span>
      </div>
    </div>
  );
}

function Keywords({ ats }: { ats: AtsDetail }) {
  const matched = [...ats.matched_required, ...ats.matched_preferred];
  return (
    <div className="kw-groups">
      <div>
        <h3>On this resume · {matched.length}</h3>
        <div className="tags">
          {matched.map((k) => (
            <span className="tag ok" key={k}>
              <Check {...ICON} size={13} />
              {k}
              {ats.matched_preferred.includes(k) && <span className="muted">preferred</span>}
            </span>
          ))}
          {!matched.length && <span className="muted small">None of the job's keywords were found.</span>}
        </div>
      </div>
      {!!ats.missing_fixable.length && (
        <div>
          <h3>In your profile, not on this resume yet · {ats.missing_fixable.length}</h3>
          <div className="tags">
            {ats.missing_fixable.map((k) => (
              <span className="tag fixable" key={k}>
                {k}
              </span>
            ))}
          </div>
          <p className="muted xs" style={{ marginTop: 8 }}>
            Tailor again to work these in; they count as soon as the resume says them.
          </p>
        </div>
      )}
      {!!ats.missing_gaps.length && (
        <div>
          <h3>Not in your profile · {ats.missing_gaps.length}</h3>
          <div className="tags">
            {ats.missing_gaps.map((k) => (
              <Link className="tag hidden-line" key={k} to={`/skills#${encodeURIComponent(k.toLowerCase())}`}>
                {k}
              </Link>
            ))}
          </div>
          <p className="muted xs" style={{ marginTop: 8 }}>
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
    <div className="rounds" aria-label="Revision rounds">
      {rounds.map((r, i) => (
        <span key={i} className="row" style={{ gap: 8 }}>
          {i > 0 && <ArrowRight {...ICON} size={12} />}
          <span className={`pill${i === kept ? " kept" : ""}`} title={i === kept ? "Kept: the highest-scoring honest version" : undefined}>
            {i === 0 ? "Draft" : `R${i}`} · {r}
          </span>
        </span>
      ))}
    </div>
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
        <div className="panel-pad" style={{ paddingBottom: 0 }}>
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
          <div className="panel-pad" style={{ borderTop: "1px solid var(--line)" }}>
            <h3 className="xs muted" style={{ marginBottom: 8, fontWeight: 500 }}>
              What this job asks for
            </h3>
            <div className="tags">
              {[...req, ...pref].map((k) => {
                const ok = have.has(k.toLowerCase());
                return (
                  <span key={k} className={`tag${ok ? " ok" : " hidden-line"}`} title={ok ? "In your profile" : "Not in your profile"}>
                    {ok && <Check {...ICON} size={13} />}
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
          <p className="muted xs" style={{ marginTop: 4 }}>
            Read from the compiled PDF's text, the way a keyword ATS reads it.
          </p>
        </div>
        <div className="ats-figure">
          <span className="big">{ats.score}</span>
          <span className="muted">/ 100</span>
          <span className={`pill ats ats-verdict ${v.cls}`}>{v.text}</span>
        </div>
      </div>

      {best < ATS_MINIMUM && (
        <div className="notice pending">
          <div>
            The best honest score for this job is <strong>{best}</strong>, under the {ATS_MINIMUM} minimum. It is held back by{" "}
            {ats.missing_gaps.slice(0, 4).join(", ")}, which your profile does not list.
          </div>
        </div>
      )}

      <ScoreBar ats={ats} drawKey={t?.id ?? job.id} />

      <div className="parts-head" aria-hidden>
        <span>Part</span>
        <span>Earned</span>
        <span>Best honest</span>
      </div>
      <div className="parts" role="table" aria-label="ATS score parts">
        {ATS_PARTS.map((p) => {
          const part = ats.breakdown[p.key];
          if (!part) return null;
          const reach = Math.max(ats.reach?.[p.key] ?? part.points, part.points);
          return (
            <div className="part" role="row" key={p.key}>
              <div role="cell">
                <div className="name">{p.label}</div>
                <div className="note">
                  {part.note}
                  {p.key === "placement" && ats.skills_only.length > 0 && `: ${ats.skills_only.join(", ")}`}
                  {p.key === "title" && ats.best_title && reach > part.points && `; best allowed headline: ${ats.best_title}`}
                </div>
              </div>
              <div className="val" role="cell">
                {fmt(part.points)} <span className="muted">/ {part.max}</span>
              </div>
              <div className={`best${reach > part.points ? "" : " same"}`} role="cell">
                {reach > part.points ? (
                  <>
                    <ArrowRight {...ICON} size={12} />
                    {fmt(reach)}
                  </>
                ) : (
                  "same"
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Keywords ats={ats} />

      {!!ats.rounds && ats.rounds.length > 1 && (
        <div style={{ marginTop: 20 }}>
          <h3 className="xs muted" style={{ marginBottom: 8, fontWeight: 500 }}>
            Revisions: the highest-scoring honest version is kept
          </h3>
          <Rounds rounds={ats.rounds} />
        </div>
      )}
    </section>
  );
}
