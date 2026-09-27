// Service worker: talks to Supabase (auth, PostgREST, Storage) with your login, so content scripts and
// the popup never hold credentials. Everything lives in chrome.storage.local on this machine only.
importScripts("lib/urlkey.js");

const store = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (obj) => chrome.storage.local.set(obj),
};

async function config() {
  const { supabaseUrl, anonKey, session } = await store.get(["supabaseUrl", "anonKey", "session"]);
  if (!supabaseUrl || !anonKey) throw new Error("Set your Supabase URL and anon key in the extension options.");
  return { base: supabaseUrl.replace(/\/+$/, ""), anonKey, session };
}

async function authRequest(grant, body) {
  const { base, anonKey } = await config();
  const res = await fetch(`${base}/auth/v1/token?grant_type=${grant}`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || data.error || `login failed (${res.status})`);
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
    email: data.user?.email,
  };
  await store.set({ session });
  return session;
}

async function token() {
  const { session } = await config();
  if (!session) throw new Error("Not signed in. Open the extension options and sign in.");
  if (Date.now() < session.expires_at) return session.access_token;
  return (await authRequest("refresh_token", { refresh_token: session.refresh_token })).access_token;
}

async function rest(path, { method = "GET", body, prefer } = {}) {
  const { base, anonKey } = await config();
  const headers = { apikey: anonKey, Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && (data.message || data.error)) || `request failed (${res.status})`);
  return data;
}

const JOB_FIELDS = "id,title,company,status,llm_score,apply_url,tailorings(id,status,pdf_path,created_at)";

async function findJob(url, company) {
  const key = self.JobbotUrlKey.urlKey(url);
  if (key) {
    const rows = await rest(`/rest/v1/job_links?select=job_id,jobs(${JOB_FIELDS})&url_key=eq.${encodeURIComponent(key)}`);
    if (rows.length && rows[0].jobs) return { match: "url", jobs: [rows[0].jobs] };
  }
  if (company) {
    const q = encodeURIComponent(`*${company.replace(/[*,()]/g, " ").trim()}*`);
    const jobs = await rest(`/rest/v1/jobs?select=${JOB_FIELDS}&company=ilike.${q}&order=created_at.desc&limit=6`);
    return { match: "company", jobs };
  }
  return { match: "none", jobs: [] };
}

function latestPdf(job) {
  const t = [...(job.tailorings || [])].filter((x) => x.pdf_path).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return t[0]?.pdf_path || null;
}

async function resumeFor(jobId) {
  const [job] = await rest(`/rest/v1/jobs?select=${JOB_FIELDS}&id=eq.${jobId}`);
  const path = job && latestPdf(job);
  if (!path) return null;
  const { base } = await config();
  const signed = await rest(`/storage/v1/object/sign/resumes/${path}`, { method: "POST", body: { expiresIn: 300 } });
  const res = await fetch(`${base}/storage/v1${signed.signedURL}`);
  if (!res.ok) throw new Error(`could not download resume (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const { profile } = await store.get("profile");
  const name = [profile?.firstName, profile?.lastName].filter(Boolean).join("_") || "Resume";
  return { name: `${name}_Resume.pdf`, base64: btoa(binary) };
}

const handlers = {
  async login({ email, password }) {
    const s = await authRequest("password", { email, password });
    return { email: s.email };
  },
  async logout() {
    await chrome.storage.local.remove("session");
    return {};
  },
  async status() {
    const { session, supabaseUrl } = await store.get(["session", "supabaseUrl"]);
    return { configured: !!supabaseUrl, email: session?.email || null };
  },
  async findJob({ url, company }) {
    return findJob(url, company);
  },
  async captureJob({ job }) {
    const id = await rest("/rest/v1/rpc/capture_job", {
      method: "POST",
      body: {
        p_title: job.title,
        p_company: job.company,
        p_location: job.location || null,
        p_description: job.description || null,
        p_url: job.url,
        p_url_key: job.url_key,
        p_source: job.source || "extension",
        p_queue: true,
      },
    });
    return { id };
  },
  async markApplied({ jobId }) {
    await rest(`/rest/v1/jobs?id=eq.${jobId}`, { method: "PATCH", body: { status: "applied" }, prefer: "return=minimal" });
    return {};
  },
  async resume({ jobId }) {
    return { resume: await resumeFor(jobId) };
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler(msg)
    .then((data) => reply({ ok: true, ...data }))
    .catch((err) => reply({ ok: false, error: err.message }));
  return true; // async reply
});
