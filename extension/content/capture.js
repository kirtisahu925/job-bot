// Runs on LinkedIn, Indeed, Naukri, Foundit and Wellfound job pages. Adds a small "Save job" button that
// sends the posting to your tracker, queued for a tailored resume at the next 10:00 / 22:00 run.
(function () {
  if (globalThis.__jobbotCapture) return;
  globalThis.__jobbotCapture = true;
  const { urlKey, sourceOf } = globalThis.JobbotUrlKey;
  const { extractJob } = globalThis.JobbotExtract;

  const JOB_PAGE = {
    linkedin: /\/jobs\/(view|search|collections)|currentJobId=/,
    indeed: /viewjob|[?&]vjk=|[?&]jk=/,
    naukri: /job-listings-/,
    foundit: /\/job\//,
    wellfound: /\/jobs\/\d+|\/jobs\?.*job_listing/,
  };

  function site() {
    const h = location.hostname;
    if (h.includes("linkedin.")) return "linkedin";
    if (h.includes("indeed.")) return "indeed";
    if (h.includes("naukri.")) return "naukri";
    if (h.includes("foundit.")) return "foundit";
    if (h.includes("wellfound.") || h.includes("angel.co")) return "wellfound";
    return null;
  }

  function toast(message, ok = true) {
    const t = document.createElement("div");
    t.textContent = message;
    Object.assign(t.style, {
      position: "fixed", right: "20px", bottom: "76px", zIndex: 2147483647, maxWidth: "320px",
      background: ok ? "#0b0b0b" : "#b42f2f", color: "#fff", padding: "10px 14px", borderRadius: "10px",
      font: "13px system-ui, sans-serif", boxShadow: "0 6px 20px rgba(0,0,0,.25)",
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }

  async function save(button) {
    const s = site();
    const job = extractJob(document, s);
    if (!job.title || !job.company) {
      toast("Could not read this job's title/company. Open the job's own page and try again.", false);
      return;
    }
    button.disabled = true;
    button.textContent = "Saving…";
    const url = location.href;
    const res = await chrome.runtime.sendMessage({
      type: "captureJob",
      job: { ...job, url, url_key: urlKey(url), source: sourceOf(url) || s },
    });
    button.disabled = false;
    if (res?.ok) {
      button.textContent = "✓ Saved";
      toast(`Saved "${job.title}" at ${job.company}. A tailored resume will be ready after the next run.`);
    } else {
      button.textContent = "Save job";
      toast(res?.error || "Not saved. Open the extension options and sign in.", false);
    }
  }

  function ensureButton() {
    const s = site();
    const onJob = s && JOB_PAGE[s].test(location.pathname + location.search);
    let button = document.getElementById("jobbot-save");
    if (!onJob) {
      button?.remove();
      return;
    }
    if (button) return;
    button = document.createElement("button");
    button.id = "jobbot-save";
    button.type = "button";
    button.textContent = "Save job";
    button.title = "Save to your job tracker and queue a tailored resume";
    Object.assign(button.style, {
      position: "fixed", right: "20px", bottom: "20px", zIndex: 2147483647, padding: "10px 16px",
      border: "none", borderRadius: "999px", background: "#2a78d6", color: "#fff", cursor: "pointer",
      font: "600 14px system-ui, sans-serif", boxShadow: "0 6px 20px rgba(0,0,0,.25)",
    });
    button.addEventListener("click", () => save(button));
    document.body.appendChild(button);
  }

  // job sites are single-page apps: re-check when the URL changes
  let last = "";
  setInterval(() => {
    if (location.href !== last) {
      last = location.href;
      const b = document.getElementById("jobbot-save");
      if (b) b.textContent = "Save job";
      ensureButton();
    }
  }, 800);
  ensureButton();
})();
