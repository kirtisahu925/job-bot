import type { RoundRecord } from "../lib/types";
import { AtsScore } from "./bits";

const VERDICT: Record<NonNullable<RoundRecord["review"]>["verdict"], string> = {
  reject: "would reject the draft",
  maybe: "on the fence about the draft",
  interview: "would interview",
  strong_interview: "would push to interview",
};

function Chips({ items, tone }: { items: string[]; tone?: "gap" }) {
  if (!items.length) return <span className="muted">none</span>;
  return (
    <span className="chips">
      {items.map((k) => (
        <span key={k} className={`tag${tone ? ` ${tone}` : ""}`}>
          {k}
        </span>
      ))}
    </span>
  );
}

/** How a tailored resume was built: the build round's reasoning, each reviewer's findings, the ATS score after each. */
export default function ResumeRounds({ rounds, target }: { rounds: RoundRecord[]; target?: number }) {
  const kept = rounds.find((r) => r.kept);
  return (
    <section className="panel panel-pad" aria-labelledby="rounds-h">
      <div className="section-head">
        <div>
          <h2 id="rounds-h">How this resume was built</h2>
          <p className="muted xs" style={{ marginTop: 4 }}>
            {rounds
              .filter((r) => !r.skipped)
              .map((r) => `${r.title.replace(" review", "")} ${r.ats_score ?? "–"}`)
              .join(" → ")}
            {kept && ` · kept: ${kept.title}`}
          </p>
        </div>
      </div>
      <ol className="round-list">
        {rounds.map((r, i) => (
          <li key={i} className={r.kept ? "kept" : undefined}>
            <details open={r.kept || r.name === "build"}>
              <summary>
                <span className="round-n num">{i + 1}</span>
                <strong>{r.title}</strong>
                {r.skipped ? (
                  <span className="muted small">skipped</span>
                ) : (
                  <AtsScore score={r.ats_score} target={target} pill />
                )}
                {r.kept && <span className="tag">kept</span>}
                {r.review && <span className="muted small">{VERDICT[r.review.verdict]}</span>}
              </summary>
              <div className="round-body">
                {r.skipped && <p className="small muted">{r.skipped}</p>}
                {r.analysis && (
                  <dl className="round-facts">
                    <dt>The role</dt>
                    <dd>{r.analysis.role_focus}</dd>
                    <dt>Level</dt>
                    <dd>{r.analysis.seniority}</dd>
                    <dt>Keywords used</dt>
                    <dd>
                      <Chips items={r.analysis.keywords} />
                    </dd>
                    <dt>Gaps left out</dt>
                    <dd>
                      <Chips items={r.analysis.gaps} tone="gap" />
                    </dd>
                    {!!r.analysis.preferences_applied.length && (
                      <>
                        <dt>Your preferences</dt>
                        <dd>{r.analysis.preferences_applied.join("; ")}</dd>
                      </>
                    )}
                    <dt>Strategy</dt>
                    <dd>{r.analysis.strategy}</dd>
                  </dl>
                )}
                {r.review && (
                  <>
                    <p className="small soft">
                      <span className="muted">First look: </span>
                      {r.review.first_impression}
                    </p>
                    <ul className="findings">
                      {r.review.findings.map((f, n) => (
                        <li key={n}>
                          <span className={`sev ${f.severity}`}>{f.severity}</span>
                          <div>
                            <div className="small">
                              <span className="muted">{f.area}: </span>
                              {f.issue}
                            </div>
                            <div className="small soft">Fix: {f.fix}</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <p className="small soft">
                      <span className="muted">After: </span>
                      {r.review.after}
                    </p>
                  </>
                )}
                {!r.review && !r.analysis && !r.skipped && !!r.problems.length && (
                  <ul className="small soft" style={{ margin: 0, paddingLeft: 18 }}>
                    {r.problems.map((p, n) => (
                      <li key={n}>{p}</li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}
