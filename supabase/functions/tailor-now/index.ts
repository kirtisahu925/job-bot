// "Tailor now": queue one job and start the GitHub Actions workflow that tailors it (about 3 minutes).
//
// Called by the dashboard and the Chrome extension with the signed-in user's token. Only the owner
// (public.app_owner) may call it. The GitHub token lives only here, as a function secret:
//   GH_DISPATCH_TOKEN  fine-grained token for this repository with "Actions: Read and write"
//   GH_REPO            optional, default ankit-shilarkar/sde-job-bot
//   GH_REF             optional, default main
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "use POST" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });

  const { data: isOwner, error: ownerError } = await supabase.rpc("is_owner");
  if (ownerError || isOwner !== true) return json({ error: "Sign in as the tracker's owner first." }, 403);

  let jobId = "";
  try {
    jobId = String((await req.json()).job_id ?? "");
  } catch {
    return json({ error: "Body must be JSON: {\"job_id\": \"...\"}" }, 400);
  }
  if (!UUID.test(jobId)) return json({ error: "job_id must be a job's id" }, 400);

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, title, tailor_requested_at")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) return json({ error: jobError.message }, 400);
  if (!job) return json({ error: "Job not found" }, 404);

  const last = job.tailor_requested_at ? Date.parse(job.tailor_requested_at) : 0;
  if (Date.now() - last < 2 * 60 * 1000) {
    return json({ ok: true, message: "Already tailoring this job; it will be ready in a few minutes." }, 202);
  }

  const { error: updateError } = await supabase
    .from("jobs")
    .update({ status: "tailor_queued", tailor_requested_at: new Date().toISOString() })
    .eq("id", jobId);
  if (updateError) return json({ error: updateError.message }, 400);

  const token = Deno.env.get("GH_DISPATCH_TOKEN");
  if (!token) {
    return json({ ok: true, message: "Queued. Add the GH_DISPATCH_TOKEN secret to start it immediately; otherwise the next scheduled run tailors it." }, 202);
  }
  const repo = Deno.env.get("GH_REPO") ?? "ankit-shilarkar/sde-job-bot";
  const ref = Deno.env.get("GH_REF") ?? "main";
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/tailor.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "jobbot-tailor-now",
    },
    body: JSON.stringify({ ref, inputs: { job_id: jobId } }),
  });
  if (res.status !== 204) {
    return json({ error: `GitHub refused to start the workflow (${res.status}): ${(await res.text()).slice(0, 300)}` }, 502);
  }
  return json({ ok: true, message: `Tailoring "${job.title}". The resume and ATS score appear in about 3 minutes.` }, 202);
});
