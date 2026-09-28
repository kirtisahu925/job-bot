import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { Job, JobStatus } from "./types";

export function useJobs() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api.listJobs().then(setJobs, (e: Error) => setError(e.message));
  }, []);

  useEffect(reload, [reload]);

  const setStatus = useCallback(async (id: string, status: JobStatus) => {
    setJobs((prev) => prev?.map((j) => (j.id === id ? { ...j, status } : j)) ?? prev);
    try {
      await api.updateJob(id, { status });
    } catch (e) {
      setError((e as Error).message);
      reload();
    }
  }, [reload]);

  const replace = useCallback((job: Job) => {
    setJobs((prev) => prev?.map((j) => (j.id === job.id ? { ...j, ...job } : j)) ?? prev);
  }, []);

  return { jobs, error, reload, setStatus, replace };
}
