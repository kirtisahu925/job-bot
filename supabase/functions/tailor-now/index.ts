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

/** What the saved secret looks like, without revealing any of it: only GitHub's public prefixes and the length. */
export function tokenShape(token: string): string {
  const n = token.length;
  if (!/^(github_pat_|ghp_|gh[ousr]_)/.test(token)) {
    return `The saved value (${n} characters) does not start with github_pat_ or ghp_, so it is not a GitHub token: it ` +
      "may be the token's name or note rather than the token itself.";
  }
  if (/^gh[ousr]_/.test(token)) {
    return "The saved value is an app or OAuth token, which cannot start workflows: create a fine-grained personal access token.";
  }
  if (/\s/.test(token)) return `The saved value has spaces or line breaks inside it (${n} characters): paste the token alone.`;
  if (/[^\x21-\x7e]/.test(token)) return `The saved value has characters a token never has (${n} characters), e.g. "…" from a shortened copy.`;
  if (token.startsWith("github_pat_")) {
    return /^github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}$/.test(token)
      ? "The saved value is a complete fine-grained token (93 characters), so GitHub has revoked it, it has expired, or it " +
          "is not the token you just created (the new value may not have been saved)."
      : `The saved value starts like a fine-grained token but is ${n} characters long instead of 93: part of it is missing ` +
          "or something extra was pasted.";
  }
  return /^ghp_[A-Za-z0-9]{36}$/.test(token)
    ? "The saved value is a complete classic token (40 characters), so GitHub has revoked it or it has expired."
    : `The saved value starts like a classic token but is ${n} characters long instead of 40: part of it is missing.`;
}

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

  // a secret pasted with a trailing newline, spaces or quotes is still the token
  const token = (Deno.env.get("GH_DISPATCH_TOKEN") ?? "").trim().replace(/^["']|["']$/g, "");
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
    // nothing is running: no "tailoring" spinner, and pressing again is not blocked; the job stays queued for the scan
    await supabase.from("jobs").update({ tailor_requested_at: job.tailor_requested_at }).eq("id", jobId);
    const fallback = " The job stays queued, so the next scheduled scan (10:00 or 22:00 IST) tailors it anyway.";
    const fixes: Record<number, string> = {
      401:
        "GitHub does not recognise the GH_DISPATCH_TOKEN secret (401 Bad credentials). " + tokenShape(token) +
        " Fix: GitHub, Settings, Developer settings, Fine-grained tokens, Generate new token (Repository access: only " +
        "sde-job-bot; Permissions: Actions, Read and write), copy it with the copy button, then Supabase, Edge " +
        "Functions, Secrets: replace GH_DISPATCH_TOKEN and press Save.",
      403:
        "GitHub accepted the token but it may not start workflows (403): give it Actions, Read and write, on the " +
        "sde-job-bot repository.",
      404:
        `GitHub cannot see ${repo} or its tailor.yml with this token (404): make sure the token's repository access ` +
        "includes sde-job-bot.",
      422: `GitHub could not start tailor.yml on "${ref}" (422): the workflow must exist on that branch.`,
    };
    const detail = fixes[res.status] ?? `GitHub refused to start the workflow (${res.status}): ${(await res.text()).slice(0, 300)}`;
    return json({ error: detail + fallback }, 502);
  }
  return json({ ok: true, message: `Tailoring "${job.title}". The resume and ATS score appear in about 3 minutes.` }, 202);
});
