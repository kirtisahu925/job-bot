// Service worker: talks to Supabase (auth, PostgREST, Storage) with your login, so content scripts and
// the popup never hold credentials. Everything lives in chrome.storage.local on this machine only.
importScripts("lib/urlkey.js", "lib/fieldmap.js", "lib/autoapply.js");

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

const JOB_FIELDS =
  "id,title,company,status,llm_score,ats_score,tailor_requested_at,apply_url,tailorings(id,status,pdf_path,created_at,ats_score,cover_letter)";

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

/** The newest cover letter saved for a job, or null. */
async function coverLetterFor(jobId) {
  const [job] = await rest(`/rest/v1/jobs?select=${JOB_FIELDS}&id=eq.${jobId}`);
  const t = [...(job?.tailorings || [])].filter((x) => x.cover_letter).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return t[0]?.cover_letter || null;
}

const SETTABLE = new Set(["applied", "expired", "skipped"]);
async function setJobStatus(jobId, status) {
  if (!SETTABLE.has(status)) throw new Error(`cannot set status ${status} from the extension`);
  await rest(`/rest/v1/jobs?id=eq.${jobId}`, { method: "PATCH", body: { status }, prefer: "return=minimal" });
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

// ---- Apply queue ------------------------------------------------------------------------------------------
// Opens each qualifying job's application in a background tab, one at a time, fills it with content/apply.js
// and leaves it at its Submit button. Nothing is sent: you review each tab and submit it yourself.
const AA = self.JobbotAutoApply;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function queueState() {
  const { autoApply, autoApplyState } = await store.get(["autoApply", "autoApplyState"]);
  return {
    settings: AA.settingsOf(autoApply),
    state: { running: false, current: null, results: [], tried: {}, ...(autoApplyState || {}) },
  };
}

async function saveQueue(patch) {
  const { state } = await queueState();
  const next = { ...state, ...patch };
  next.results = next.results.slice(-60);
  await store.set({ autoApplyState: next });
  return next;
}

// A worker that the browser restarted mid-run is no longer running it.
queueState().then(({ state }) => state.running && saveQueue({ running: false, current: null, stopped: "The browser stopped the queue; start it again." }));

async function queueJobs(settings, tried) {
  const jobs = await rest(
    "/rest/v1/jobs?select=id,title,company,status,verdict,apply_url,llm_score,ats_score&status=eq.tailored&apply_url=not.is.null" +
      "&order=llm_score.desc.nullslast&limit=100",
  );
  return AA.eligible(jobs, settings, tried);
}

function tabLoaded(tabId, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    const onUpdated = (id, info) => id === tabId && info.status === "complete" && done();
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((t) => t.status === "complete" && done(), done);
  });
}

async function prepareOne(job) {
  const { profile = {}, customAnswers = "", defaultResume = null } = await store.get(["profile", "customAnswers", "defaultResume"]);
  const resume = (await resumeFor(job.id).catch(() => null)) || defaultResume;
  const coverLetter = await coverLetterFor(job.id).catch(() => null);
  const tab = await chrome.tabs.create({ url: job.apply_url, active: false });
  try {
    await tabLoaded(tab.id);
    await sleep(2500); // client-rendered forms
    const target = { tabId: tab.id, allFrames: true };
    await chrome.scripting.executeScript({ target, files: ["lib/fieldmap.js", "content/autofill.js", "content/apply.js"] });
    const payload = {
      profile: { ...profile, coverLetter },
      customAnswers: self.JobbotFieldMap.parseCustomAnswers(customAnswers),
      resume,
      closedPattern: AA.CLOSED_PAGE.source,
    };
    const frames = await chrome.scripting.executeScript({ target, args: [payload], func: (p) => globalThis.JobbotApply.run(p) });
    const outcome = AA.pickOutcome(frames.map((f) => f.result));
    // a posting that stopped taking applications leaves the queue for good
    if (outcome.state === "closed") await setJobStatus(job.id, "expired").catch(() => {});
    const keep = AA.KEEP_TAB.has(outcome.state);
    if (!keep) await chrome.tabs.remove(tab.id).catch(() => {});
    return { ...outcome, note: resume ? outcome.note : `${outcome.note} No resume was available to attach.`, tabId: keep ? tab.id : null };
  } catch (err) {
    return { state: "error", note: err.message, tabId: tab.id };
  }
}

async function runQueue() {
  let { settings, state } = await queueState();
  if (!settings.enabled) throw new Error("The apply queue is off. Turn it on in Profile and settings.");
  if (state.running) return;
  const queue = await queueJobs(settings, state.tried);
  await saveQueue({ running: true, stopped: null, queued: queue.length, startedAt: new Date().toISOString() });
  // any extension call resets the worker's idle timer; this keeps it alive through slow pages
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  try {
    for (const [i, job] of queue.entries()) {
      ({ state } = await queueState());
      if (!state.running) break;
      if (AA.openedToday(state.results) >= settings.dailyCap) {
        await saveQueue({ stopped: `Daily limit of ${settings.dailyCap} applications reached.` });
        break;
      }
      await saveQueue({ current: { id: job.id, title: job.title, company: job.company } });
      const result = await prepareOne(job);
      const entry = { jobId: job.id, title: job.title, company: job.company, url: job.apply_url, at: new Date().toISOString(), ...result };
      ({ state } = await queueState());
      await saveQueue({ results: [...state.results, entry], tried: { ...state.tried, [job.id]: entry.at }, current: null });
      if (i < queue.length - 1) {
        const pause = settings.pauseSeconds * 1000 * (0.75 + Math.random() * 0.5);
        for (let waited = 0; waited < pause && (await queueState()).state.running; waited += 5000) await sleep(Math.min(5000, pause - waited));
      }
    }
  } finally {
    clearInterval(keepAlive);
    await saveQueue({ running: false, current: null, finishedAt: new Date().toISOString() });
  }
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
  async saveInbox({ jobs }) {
    const clip = (v, n) => (v == null || v === "" ? null : String(v).slice(0, n));
    const rows = (jobs || [])
      .filter((j) => j.url_key && j.title && j.company && j.url)
      .map((j) => ({
        source: clip(j.source, 40) || "extension",
        url: clip(j.url, 2000),
        url_key: clip(j.url_key, 300),
        title: clip(j.title, 300),
        company: clip(j.company, 200),
        location: clip(j.location, 300),
        description: clip(j.description, 60000),
        experience_text: clip(j.experience_text, 120),
        job_type: clip(j.job_type, 80),
        posted_at: j.posted_at || null,
      }));
    if (!rows.length) return { saved: 0, skipped: 0 };
    const inserted = await rest("/rest/v1/job_inbox?on_conflict=url_key&select=id", {
      method: "POST",
      body: rows,
      prefer: "resolution=ignore-duplicates,return=representation",
    });
    const saved = (inserted || []).length;
    return { saved, skipped: rows.length - saved };
  },
  async markApplied({ jobId }) {
    await setJobStatus(jobId, "applied");
    return {};
  },
  async setStatus({ jobId, status }) {
    await setJobStatus(jobId, status);
    return {};
  },
  async resume({ jobId }) {
    return { resume: await resumeFor(jobId) };
  },
  async coverLetter({ jobId }) {
    return { coverLetter: await coverLetterFor(jobId) };
  },
  async queuePreview() {
    const { settings, state } = await queueState();
    let ready = [];
    let error = null;
    if (settings.enabled) {
      try {
        ready = await queueJobs(settings, state.tried);
      } catch (err) {
        error = err.message; // still show what the queue already prepared
      }
    }
    return {
      settings,
      state,
      error,
      ready: ready.map(({ id, title, company, apply_url, llm_score, ats_score }) => ({ id, title, company, apply_url, llm_score, ats_score })),
      openedToday: AA.openedToday(state.results),
    };
  },
  async queueStart() {
    runQueue().catch((err) => saveQueue({ running: false, current: null, stopped: err.message }));
    return {};
  },
  async queueStop() {
    await saveQueue({ running: false, stopped: "Stopped by you." });
    return {};
  },
  async queueFocus({ tabId }) {
    await chrome.tabs.update(tabId, { active: true });
    return {};
  },
  // Starts the GitHub Action that tailors this job (through the tailor-now Edge Function; about 3 minutes).
  async tailorNow({ jobId }) {
    const { base, anonKey } = await config();
    const res = await fetch(`${base}/functions/v1/tailor-now`, {
      method: "POST",
      headers: { apikey: anonKey, Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Tailor now failed (${res.status})`);
    return { message: data.message || "Tailoring started." };
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
