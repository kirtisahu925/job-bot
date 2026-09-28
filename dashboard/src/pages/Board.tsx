import { useState } from "react";
import { Link } from "react-router-dom";
import { AtsScore, MatchScore, Notice, StatusMark } from "../components/bits";
import { STATUS_LABEL, type Job, type JobStatus } from "../lib/types";
import { useJobs } from "../lib/useJobs";
import { useTitle } from "../lib/useTitle";

const BANDS: { title: string; columns: JobStatus[] }[] = [
  { title: "Before you apply", columns: ["new", "shortlisted", "tailor_queued", "tailored"] },
  { title: "After you apply", columns: ["applied", "interviewing", "offer", "rejected"] },
];

function Card({ job }: { job: Job }) {
  return (
    <div
      className="jobcard"
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", job.id)}
      aria-label={`${job.title} at ${job.company}`}
    >
      <Link className="role-title" to={`/jobs/${job.id}`}>
        {job.title}
      </Link>
      <div className="role-sub">{job.company}</div>
      <div className="meta">
        <span>{job.remote ? "Remote" : job.city ?? job.location}</span>
        <span>
          Match <MatchScore score={job.llm_score} /> · ATS <AtsScore score={job.ats_score ?? job.tailorings[0]?.ats_score} />
        </span>
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
          <p className="lede">Drag a card to another column to change its status, or change it on the job's page.</p>
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {BANDS.map((band) => (
        <section key={band.title} className="section" aria-label={band.title}>
          <h2 style={{ marginBottom: 10 }}>{band.title}</h2>
      <div className="board">
        {band.columns.map((col) => {
          const items = (jobs ?? [])
            .filter((j) => j.status === col)
            .sort((a, b) => (b.llm_score ?? 0) - (a.llm_score ?? 0));
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
                <StatusMark status={col} />
                <span className="num">{jobs ? items.length : "…"}</span>
              </div>
              {items.map((j) => (
                <Card key={j.id} job={j} />
              ))}
              {jobs && items.length === 0 && <p className="muted small">Nothing here.</p>}
            </section>
          );
        })}
      </div>
        </section>
      ))}
    </>
  );
}
