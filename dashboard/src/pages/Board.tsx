import { useState } from "react";
import { Link } from "react-router-dom";
import { PdfLink, ScoreBadge } from "../components/bits";
import { STATUS_LABEL, type Job, type JobStatus } from "../lib/types";
import { useJobs } from "../lib/useJobs";

const COLUMNS: JobStatus[] = ["new", "shortlisted", "tailor_queued", "tailored", "applied", "interviewing", "offer", "rejected"];

function Card({ job }: { job: Job }) {
  return (
    <div
      className="jobcard"
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", job.id)}
      aria-label={`${job.title} at ${job.company}`}
    >
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <Link className="title" to={`/jobs/${job.id}`}>
          {job.title}
        </Link>
        <ScoreBadge score={job.llm_score} />
      </div>
      <div className="secondary">{job.company}</div>
      <div className="row muted" style={{ fontSize: 12, marginTop: 4 }}>
        {job.remote ? "Remote" : job.city ?? job.location}
        {job.tailorings[0]?.pdf_path && <PdfLink path={job.tailorings[0].pdf_path} label="Resume" />}
      </div>
    </div>
  );
}

export default function Board() {
  const { jobs, error, setStatus } = useJobs();
  const [over, setOver] = useState<JobStatus | null>(null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Board</h1>
          <div className="muted">Drag a card to change its status. Queued jobs get a tailored resume on the next run.</div>
        </div>
      </div>
      {error && <div className="banner error">{error}</div>}
      <div className="board">
        {COLUMNS.map((col) => {
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
                <span>{STATUS_LABEL[col]}</span>
                <span className="muted num">{items.length}</span>
              </div>
              {items.map((j) => (
                <Card key={j.id} job={j} />
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
