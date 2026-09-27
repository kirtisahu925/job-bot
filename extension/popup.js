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

function renderJobs(result) {
  const box = $("job");
  box.replaceChildren();
  selectedJob = null;
  if (!result?.ok) {
    box.append(el("span", { className: "bad", textContent: result?.error || "Lookup failed" }));
    return;
  }
  if (!result.jobs.length) {
    box.append("Not in your tracker yet. Use “Save this job” or search by company.");
    return;
  }
  for (const job of result.jobs) {
    const hasPdf = (job.tailorings || []).some((t) => t.pdf_path);
    const radio = el("input", { type: "radio", name: "job", value: job.id, checked: result.jobs.length === 1 });
    radio.addEventListener("change", () => (selectedJob = job));
    if (radio.checked) selectedJob = job;
    const applied = el("button", { textContent: job.status === "applied" ? "Applied ✓" : "Mark applied", disabled: job.status === "applied" });
    applied.addEventListener("click", async () => {
      const r = await send({ type: "markApplied", jobId: job.id });
      applied.textContent = r.ok ? "Applied ✓" : r.error;
      applied.disabled = r.ok;
    });
    box.append(
      el(
        "div",
        { className: "stack", style: "margin-bottom:8px" },
        el("label", { className: "row" }, radio, el("strong", { textContent: job.title })),
        el("span", { className: "muted", textContent: `${job.company} · score ${job.llm_score ?? "–"} · ${job.status.replace("_", " ")}` }),
        el("span", { className: hasPdf ? "ok" : "muted", textContent: hasPdf ? "Tailored resume ready" : "No tailored resume yet (your default resume will be used)" }),
        el("div", { className: "row" }, applied),
      ),
    );
  }
}

async function init() {
  const status = await send({ type: "status" });
  if (!status?.configured) $("account").textContent = "Not connected to Supabase yet. Open Profile & settings.";
  else if (!status.email) $("account").textContent = "Not signed in. Open Profile & settings.";
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
  $("fill-result").textContent = r.ok ? `Saved “${job.title}”. Resume will be tailored at the next run.` : r.error;
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

init();
