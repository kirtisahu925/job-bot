const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
let selectedJob = null;

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) node.append(c);
  return node;
}

const TAILOR_WINDOW_MS = 15 * 60 * 1000;
const STATUS_LABEL = {
  new: "New", shortlisted: "Shortlisted", tailor_queued: "Queued for resume", tailored: "Resume ready",
  applied: "Applied", interviewing: "Interviewing", offer: "Offer", rejected: "Rejected", skipped: "Skipped",
  archived: "Archived",
};

function latestTailoring(job) {
  return [...(job.tailorings || [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;
}

function isTailoring(job) {
  const requested = job.tailor_requested_at ? Date.parse(job.tailor_requested_at) : 0;
  const latest = latestTailoring(job);
  return requested > (latest ? Date.parse(latest.created_at) : 0) && Date.now() - requested < TAILOR_WINDOW_MS;
}

function minutesAgo(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "just now" : `${m}m ago`;
}

function atsText(score) {
  if (score == null) return el("span", { className: "muted", textContent: "–" });
  const cls = score >= 90 ? "ok" : score >= 80 ? "" : "bad";
  return el("strong", { className: `num ${cls}`, textContent: String(score), title: score >= 80 ? "ATS 80 or more" : "ATS below the 80 minimum" });
}

function renderJobs(result) {
  const box = $("job");
  box.replaceChildren();
  selectedJob = null;
  if (!result?.ok) {
    box.append(el("p", { className: "bad", textContent: result?.error || "Lookup failed" }));
    return;
  }
  if (!result.jobs.length) {
    box.append(el("p", { className: "soft", style: "margin-bottom:8px", textContent: "Not in your tracker yet. Save it below, or search by company." }));
    return;
  }
  for (const job of result.jobs) {
    const latest = latestTailoring(job);
    const hasPdf = !!latest?.pdf_path;
    const radio = el("input", { type: "radio", name: "job", value: job.id, checked: result.jobs.length === 1 });
    radio.addEventListener("change", () => (selectedJob = job));
    if (radio.checked) selectedJob = job;

    const applied = el("button", { textContent: job.status === "applied" ? "Applied" : "Mark applied", disabled: job.status === "applied" });
    applied.addEventListener("click", async () => {
      const r = await send({ type: "markApplied", jobId: job.id });
      applied.textContent = r.ok ? "Applied" : r.error;
      applied.disabled = r.ok;
    });

    const resumeLine = el("span");
    const tailor = el("button", { className: "act", textContent: hasPdf ? "Tailor again" : "Tailor now" });
    const showTailoring = (since) => {
      resumeLine.replaceChildren(el("span", { className: "working", textContent: `Tailoring, started ${minutesAgo(since)}` }),
        " · about 3 minutes; reopen this popup to attach it.");
      tailor.disabled = true;
    };
    if (isTailoring(job)) showTailoring(job.tailor_requested_at);
    else resumeLine.append(hasPdf ? el("span", { className: "ok", textContent: "Tailored resume ready" }) : el("span", { className: "soft", textContent: "No tailored resume yet; your default resume is attached instead." }));
    tailor.addEventListener("click", async () => {
      tailor.disabled = true;
      tailor.textContent = "Starting…";
      const r = await send({ type: "tailorNow", jobId: job.id });
      if (r.ok) {
        showTailoring(new Date().toISOString());
        tailor.textContent = hasPdf ? "Tailor again" : "Tailor now";
      } else {
        resumeLine.replaceChildren(el("span", { className: "bad", textContent: r.error }));
        tailor.disabled = false;
        tailor.textContent = hasPdf ? "Tailor again" : "Tailor now";
      }
    });

    box.append(
      el(
        "div",
        { className: "job stack" },
        el("label", { className: "row", style: "gap:8px;align-items:flex-start" }, radio, el("strong", { textContent: job.title })),
        el("span", { className: "soft", textContent: job.company }),
        el("span", { className: "row", style: "gap:10px" },
          el("span", { className: "row", style: "gap:6px" }, el("span", { className: `mark ${job.status}`, ariaHidden: "true" }), STATUS_LABEL[job.status] || job.status),
          el("span", {}, "Match ", el("strong", { className: "num", textContent: String(job.llm_score ?? "–") })),
          el("span", {}, "ATS ", atsText(job.ats_score ?? latest?.ats_score ?? null)),
        ),
        resumeLine,
        el("div", { className: "row", style: "margin-top:4px" }, tailor, applied),
      ),
    );
  }
}

async function init() {
  const status = await send({ type: "status" });
  if (!status?.configured) $("account").textContent = "Not connected to Supabase yet. Open Profile and settings.";
  else if (!status.email) $("account").textContent = "Not signed in. Open Profile and settings.";
  else $("account").textContent = `Signed in as ${status.email}`;

  const tab = await activeTab();
  if (status?.email) renderJobs(await send({ type: "findJob", url: tab.url }));
  else $("job").textContent = "Sign in to look up jobs.";
}

$("search").addEventListener("click", async () => {
  const tab = await activeTab();
  renderJobs(await send({ type: "findJob", url: tab.url, company: $("company").value }));
});

$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

$("save").addEventListener("click", async () => {
  const tab = await activeTab();
  const { urlKey, sourceOf } = globalThis.JobbotUrlKey;
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["lib/extract.js"] });
  const [{ result: job } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [sourceOf(tab.url)],
    func: (site) => globalThis.JobbotExtract.extractJob(document, site),
  });
  if (!job?.title) {
    $("fill-result").textContent = "Could not read a job from this page.";
    return;
  }
  const r = await send({ type: "captureJob", job: { ...job, url: tab.url, url_key: urlKey(tab.url), source: sourceOf(tab.url) } });
  $("fill-result").textContent = r.ok ? `Saved “${job.title}”. Press Tailor now for a resume in about 3 minutes.` : r.error;
  if (r.ok) renderJobs(await send({ type: "findJob", url: tab.url }));
});

$("autofill").addEventListener("click", async () => {
  const button = $("autofill");
  button.disabled = true;
  $("fill-result").textContent = "Filling…";
  try {
    const tab = await activeTab();
    const { profile = {}, customAnswers = "", defaultResume = null } = await chrome.storage.local.get([
      "profile",
      "customAnswers",
      "defaultResume",
    ]);
    let resume = null;
    if ($("with-resume").checked) {
      if (selectedJob) {
        const r = await send({ type: "resume", jobId: selectedJob.id });
        resume = r.ok ? r.resume : null;
      }
      resume = resume || defaultResume;
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["lib/fieldmap.js", "content/autofill.js"] });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      args: [{ profile, customAnswers: globalThis.JobbotFieldMap.parseCustomAnswers(customAnswers), resume }],
      func: (payload) => globalThis.JobbotAutofill.run(payload),
    });
    const total = results.reduce(
      (acc, { result }) => {
        if (!result) return acc;
        acc.filled += result.filled;
        acc.unmatched.push(...result.unmatched);
        acc.resume = acc.resume || result.resume;
        return acc;
      },
      { filled: 0, unmatched: [], resume: null },
    );
    const parts = [`Filled ${total.filled} field${total.filled === 1 ? "" : "s"} (outlined in green).`];
    if (total.resume) parts.push(`Attached ${total.resume}.`);
    else if ($("with-resume").checked) parts.push("No resume attached (no upload field found, or no resume available).");
    if (total.unmatched.length) parts.push(`Still needed: ${[...new Set(total.unmatched)].slice(0, 5).join("; ")}`);
    parts.push("Review everything, then submit yourself.");
    $("fill-result").textContent = parts.join(" ");
  } catch (err) {
    $("fill-result").textContent = `Could not fill this page: ${err.message}`;
  } finally {
    button.disabled = false;
  }
});

// ---- Apply queue: fills ready jobs up to their Submit button; you submit each one ----
const QUEUE_TONE = { ready: "ok", needs_you: "warn", error: "bad" };

async function renderQueue() {
  const r = await send({ type: "queuePreview" });
  const summary = $("queue-summary");
  const start = $("queue-start");
  const stop = $("queue-stop");
  if (!r?.ok) {
    summary.textContent = r?.error || "Sign in to use the apply queue.";
    start.hidden = stop.hidden = true;
    return;
  }
  const { settings, state, ready, openedToday, error } = r;
  if (error && !state.running) {
    summary.textContent = error;
    start.hidden = stop.hidden = true;
  } else if (!settings.enabled) {
    summary.textContent = "Off. Turn it on in Profile and settings; it fills applications up to Submit and never sends them.";
    start.hidden = stop.hidden = true;
  } else if (state.running) {
    summary.replaceChildren(
      el("span", { className: "working", textContent: state.current ? `Filling ${state.current.title}, ${state.current.company}` : "Starting…" }),
      ` · ${openedToday} of ${settings.dailyCap} opened today`,
    );
    start.hidden = true;
    stop.hidden = false;
  } else {
    const left = Math.max(settings.dailyCap - openedToday, 0);
    const rules = `ATS ${settings.minAts}+, match ${settings.minMatch}+${settings.linkedin ? "" : ", LinkedIn off"}`;
    summary.textContent =
      `${ready.length} ready job${ready.length === 1 ? "" : "s"} (${rules}). ${left} of ${settings.dailyCap} left today.` +
      (state.stopped ? ` ${state.stopped}` : "");
    start.hidden = false;
    start.disabled = !ready.length || !left;
    stop.hidden = true;
  }

  const list = $("queue-results");
  list.replaceChildren();
  for (const item of [...state.results].reverse().slice(0, 6)) {
    const actions = el("span", { className: "row", style: "gap:6px;margin-top:4px" });
    if (item.tabId) {
      const open = el("button", { textContent: "Open tab" });
      open.addEventListener("click", () => send({ type: "queueFocus", tabId: item.tabId }).then((x) => !x.ok && (open.textContent = "Tab closed")));
      actions.append(open);
    }
    if (item.state === "ready" || item.state === "needs_you") {
      const applied = el("button", { textContent: "Mark applied" });
      applied.addEventListener("click", async () => {
        const x = await send({ type: "markApplied", jobId: item.jobId });
        applied.textContent = x.ok ? "Applied" : x.error;
        applied.disabled = x.ok;
      });
      actions.append(applied);
    }
    list.append(
      el(
        "li",
        {},
        el("strong", { textContent: item.title }),
        el("span", { className: "soft", textContent: `, ${item.company}` }),
        el("div", { className: QUEUE_TONE[item.state] || "soft", textContent: globalThis.JobbotAutoApply.LABEL[item.state] || item.state }),
        item.note ? el("div", { className: "muted small", textContent: item.note }) : "",
        actions.childNodes.length ? actions : "",
      ),
    );
  }
}

$("queue-start").addEventListener("click", async () => {
  $("queue-start").disabled = true;
  const r = await send({ type: "queueStart" });
  if (!r.ok) $("queue-summary").textContent = r.error;
});
$("queue-stop").addEventListener("click", () => send({ type: "queueStop" }));
chrome.storage.onChanged.addListener((changes) => changes.autoApplyState && renderQueue());

init();
renderQueue();
