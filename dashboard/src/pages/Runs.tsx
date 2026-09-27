import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { compact, usd } from "../lib/format";
import type { Run } from "../lib/types";

export default function Runs() {
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
          <div className="muted">Every scheduled (10:00 / 22:00 IST) and manual run of the bot.</div>
        </div>
      </div>
      {error && <div className="banner error">{error}</div>}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Started</th>
              <th>Trigger</th>
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
            {(runs ?? []).map((r) => {
              const llm = r.summary?.llm;
              const bad = (r.summary?.sources ?? []).filter((s) => !["ok", "skipped"].includes(s.status));
              return (
                <tr key={r.id}>
                  <td>{new Date(r.started_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td>{r.trigger}</td>
                  <td>{r.status}</td>
                  <td className="right num">{r.fetched ?? "-"}</td>
                  <td className="right num">{r.new_jobs ?? "-"}</td>
                  <td className="right num">{r.scored ?? "-"}</td>
                  <td className="right num">{r.tailored ?? "-"}</td>
                  <td className="right num">
                    {llm ? compact(llm.input_tokens + llm.output_tokens + llm.thinking_tokens) : "-"}
                    {llm && llm.cost_usd > 0 && <div className="muted">{usd(llm.cost_usd)}</div>}
                  </td>
                  <td>
                    {bad.map((s) => (
                      <div key={s.source} className="muted" style={{ fontSize: 12 }}>
                        {s.source}: {s.status}
                      </div>
                    ))}
                    {r.summary?.tailor_stopped && <div className="muted" style={{ fontSize: 12 }}>{r.summary.tailor_stopped}</div>}
                    {(r.summary?.errors ?? []).map((e, i) => (
                      <div key={i} className="error" style={{ fontSize: 12 }}>
                        {e}
                      </div>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
