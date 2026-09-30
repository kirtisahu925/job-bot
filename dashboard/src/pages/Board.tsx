import { useState } from "react";
import { Link } from "react-router-dom";
import { AtsScore, MatchScore, Notice, StatusIcon } from "../components/bits";
import { STATUS_LABEL, type Job, type JobStatus } from "../lib/types";
import { useJobs } from "../lib/useJobs";
import { useTitle } from "../lib/useTitle";

const COLUMNS: JobStatus[] = ["new", "shortlisted", "tailor_queued", "tailored", "applied", "interviewing", "offer", "rejected"];

function Card({ job }: { job: Job }) {
  return (
    <div className="jobcard" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", job.id)} aria-label={`${job.title} at ${job.company}`}>
      <Link className="role-title" to={`/jobs/${job.id}`}>
        {job.title}
      </Link>
      <div className="role-sub">{job.company}</div>
      <div className="meta">
        <span className="row">
          <MatchScore score={job.llm_score} />
          <AtsScore pill score={job.ats_score ?? job.tailorings[0]?.ats_score} />
        </span>
        <span>{job.remote ? "Remote" : job.city ?? job.location}</span>
      </div>
    </div>
  );
}

export default function Board() {
  useTitle("Board");
  const { jobs, error, setStatus } = useJobs();
  const [over, setOver] = useState<JobStatus | null>(null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Board</h1>
          <p className="lede">Drag a card to another column to change its status. Scroll sideways for the columns after Applied.</p>
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="board">
        {COLUMNS.map((col) => {
          const items = (jobs ?? []).filter((j) => j.status === col).sort((a, b) => (b.llm_score ?? 0) - (a.llm_score ?? 0));
          return (
            <section
              key={col}
              className={`column${over === col ? " over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData("text/plain");
                if (id) setStatus(id, col);
              }}
              aria-label={STATUS_LABEL[col]}
            >
              <div className="column-head">
                <span className="status">
                  <StatusIcon status={col} />
                  {STATUS_LABEL[col]}
                </span>
                <span className="num">{jobs ? items.length : "…"}</span>
              </div>
              {items.map((j) => (
                <Card key={j.id} job={j} />
              ))}
              {jobs && items.length === 0 && <p className="muted xs" style={{ padding: "4px 6px" }}>Nothing here.</p>}
            </section>
          );
        })}
      </div>
    </>
  );
}
