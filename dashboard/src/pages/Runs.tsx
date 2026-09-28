import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Empty, Notice, SkeletonRows } from "../components/bits";
import { compact, istDateTime, usd } from "../lib/format";
import type { Run } from "../lib/types";
import { useTitle } from "../lib/useTitle";

const SOURCE_PROBLEM: Record<string, string> = {
  blocked: "blocked or rate-limited",
  broken: "page layout changed",
  empty: "no results",
  error: "error",
  timeout: "timed out",
};

export default function Runs() {
  useTitle("Runs");
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.runs(60).then(setRuns, (e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Runs</h1>
          <p className="lede">Every scan (10:00 and 22:00 IST), Tailor-now run and manual run, newest first.</p>
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Started (IST)</th>
              <th>Kind</th>
              <th>Status</th>
              <th className="right">Fetched</th>
              <th className="right">New</th>
              <th className="right">Scored</th>
              <th className="right">Resumes</th>
              <th className="right">Tokens</th>
              <th>Problems</th>
            </tr>
          </thead>
          <tbody>
            {!runs && <SkeletonRows cols={9} />}
            {(runs ?? []).map((r) => {
              const llm = r.summary?.llm;
              const bad = (r.summary?.sources ?? []).filter((s) => !["ok", "skipped"].includes(s.status));
              return (
                <tr key={r.id}>
                  <td className="num">{istDateTime(r.started_at)}</td>
                  <td>{r.trigger === "schedule" ? "Scan" : r.trigger === "tailor-now" ? "Tailor now" : "Manual"}</td>
                  <td className={r.status === "ok" ? "good" : r.status === "running" ? "warn" : "bad"}>
                    {r.status === "ok" ? "Finished" : r.status === "running" ? "Running" : r.status}
                  </td>
                  <td className="right num">{r.fetched ?? "-"}</td>
                  <td className="right num">{r.new_jobs ?? "-"}</td>
                  <td className="right num">{r.scored ?? "-"}</td>
                  <td className="right num">{r.tailored ?? "-"}</td>
                  <td className="right num">
                    {llm ? compact(llm.input_tokens + llm.output_tokens + llm.thinking_tokens) : "-"}
                    {llm && llm.cost_usd > 0 && <div className="muted small">{usd(llm.cost_usd)}</div>}
                  </td>
                  <td>
                    {bad.map((s) => (
                      <div key={s.source} className="small warn" title={s.error ?? undefined}>
                        {s.source}: {SOURCE_PROBLEM[s.status] ?? s.status}
                      </div>
                    ))}
                    {r.summary?.tailor_stopped && <div className="muted small">{r.summary.tailor_stopped}</div>}
                    {(r.summary?.errors ?? []).map((e, i) => (
                      <div key={i} className="error-text">
                        {e}
                      </div>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {runs && runs.length === 0 && (
          <Empty title="No runs yet">
            The first scan runs at 10:00 or 22:00 IST. To start one now: GitHub, Actions, Job scan, Run workflow.
          </Empty>
        )}
      </div>
    </>
  );
}
