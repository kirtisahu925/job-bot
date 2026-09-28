import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { TAILOR_WINDOW_MS } from "./format";
import type { Job } from "./types";

export type TailorPhase = "none" | "queued" | "tailoring" | "ready";

/** pending: a run is in flight; ok: the resume arrived; error: it could not start or never arrived. */
export interface TailorMessage {
  kind: "pending" | "ok" | "error";
  text: string;
}

/** Where a job stands on its tailored resume. "tailoring" means a Tailor-now run is in flight. */
export function tailorPhase(job: Job, now = Date.now()): TailorPhase {
  const requested = job.tailor_requested_at ? new Date(job.tailor_requested_at).getTime() : 0;
  const latest = job.tailorings[0] ? new Date(job.tailorings[0].created_at).getTime() : 0;
  if (requested && requested > latest && now - requested < TAILOR_WINDOW_MS) return "tailoring";
  if (job.status === "tailor_queued") return "queued";
  return job.tailorings[0] ? "ready" : "none";
}

/**
 * Start Tailor now for a job and keep the job fresh until the new resume lands.
 * `onJob` receives the optimistic update and every refreshed copy.
 */
export function useTailorNow(onJob: (job: Job) => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<TailorMessage | null>(null);
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((id) => window.clearInterval(id));
  }, []);

  const watch = useCallback(
    (jobId: string) => {
      if (timers.current.has(jobId)) return;
      const started = Date.now();
      const id = window.setInterval(async () => {
        const fresh = await api.getJob(jobId).catch(() => null);
        if (fresh) onJob(fresh);
        const timedOut = Date.now() - started > TAILOR_WINDOW_MS;
        if (!fresh || tailorPhase(fresh) !== "tailoring" || timedOut) {
          window.clearInterval(id);
          timers.current.delete(jobId);
          const latest = fresh?.tailorings[0];
          if (fresh && latest && tailorPhase(fresh) === "ready") {
            const score = latest.ats_score ?? latest.ats?.score;
            setMessage({ kind: "ok", text: `Resume ready for "${fresh.title}"${score != null ? `: ATS ${score}` : ""}.` });
          } else if (timedOut) {
            setMessage({ kind: "error", text: "No resume after 15 minutes. Check the Tailor now run under GitHub Actions." });
          }
        }
      }, api.demo ? 3000 : 20000);
      timers.current.set(jobId, id);
    },
    [onJob],
  );

  const start = useCallback(
    async (job: Job) => {
      setBusy(job.id);
      setMessage(null);
      try {
        const text = await api.tailorNow(job.id);
        onJob({ ...job, status: "tailor_queued", tailor_requested_at: new Date().toISOString() });
        setMessage({ kind: "pending", text });
        watch(job.id);
      } catch (e) {
        setMessage({ kind: "error", text: (e as Error).message });
      } finally {
        setBusy(null);
      }
    },
    [onJob, watch],
  );

  return { start, busy, message, watch, clearMessage: () => setMessage(null) };
}
