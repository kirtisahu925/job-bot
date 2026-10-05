// Runs on LinkedIn, Indeed, Naukri, Foundit and Wellfound job pages. Adds a small "Save job" button that
// sends the posting to your tracker, queued for a tailored resume at the next 10:00 / 22:00 run.
// On a Naukri search results page it offers "Save N jobs from this page" instead: Naukri blocks the bot,
// so your browser reads each job (one at a time, with a pause) and the next scan filters and scores them.
(function () {
  if (globalThis.__jobbotCapture) return;
  globalThis.__jobbotCapture = true;
  const { urlKey, sourceOf } = globalThis.JobbotUrlKey;
  const { extractJob, fromJsonLd } = globalThis.JobbotExtract;
  const { listJobs } = globalThis.JobbotListing;
  const BULK_SITES = ["naukri"];
  const MAX_BULK = 40; // one search page; more is a second click on the next page
  const PAUSE_MS = 800; // between job pages, like a person reading them
  let bulkBusy = false;

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

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** The full posting from the job's own page (its JSON-LD), fetched with your session; {} if unreadable. */
  async function details(url) {
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return {};
      return fromJsonLd(new DOMParser().parseFromString(await res.text(), "text/html")) || {};
    } catch {
      return {};
    }
  }

  async function saveAll(button) {
    const s = site();
    const cards = listJobs(document, s).slice(0, MAX_BULK);
    if (!cards.length) {
      toast("No job cards found on this page. Scroll so the list loads, then try again.", false);
      return;
    }
    bulkBusy = true;
    button.disabled = true;
    const jobs = [];
    for (const [i, c] of cards.entries()) {
      button.textContent = `Reading ${i + 1} of ${cards.length}…`;
      const d = await details(c.url);
      const fallback = [c.snippet, c.skills.length ? `Skills: ${c.skills.join(", ")}` : ""].filter(Boolean).join("\n");
      jobs.push({
        source: s,
        url: c.url,
        url_key: urlKey(c.url),
        title: c.title || d.title,
        company: c.company || d.company,
        location: d.location || c.location,
        description: d.description && d.description.length > 200 ? d.description : fallback || d.description || "",
        experience_text: c.experience || null,
        job_type: d.job_type || null,
        posted_at: d.posted_at || c.posted_at || null,
      });
      if (i < cards.length - 1) await sleep(PAUSE_MS);
    }
    button.textContent = "Saving…";
    const res = await chrome.runtime.sendMessage({ type: "saveInbox", jobs });
    bulkBusy = false;
    button.disabled = false;
    if (res?.ok) {
      button.textContent = `✓ Saved ${res.saved}`;
      const plural = (n) => `${n} job${n === 1 ? "" : "s"}`;
      toast(
        `Saved ${plural(res.saved)}${res.skipped ? ` (${res.skipped} already saved)` : ""}. The next scan (10:00 or 22:00 IST) ` +
          "filters and scores them like any other job.",
      );
    } else {
      button.textContent = `Save ${cards.length} jobs from this page`;
      toast(res?.error || "Not saved. Open the extension options and sign in.", false);
    }
  }

  /** On a search results page: "Save N jobs from this page", with N kept up to date as the list loads. */
  function ensureBulkButton(onJob) {
    const s = site();
    let button = document.getElementById("jobbot-save-all");
    const cards = !onJob && BULK_SITES.includes(s) ? listJobs(document, s) : [];
    if (!cards.length) {
      if (!bulkBusy) button?.remove();
      return;
    }
    const label = `Save ${Math.min(cards.length, MAX_BULK)} jobs from this page`;
    if (button) {
      if (!bulkBusy && !button.textContent.startsWith("✓")) button.textContent = label;
      return;
    }
    button = document.createElement("button");
    button.id = "jobbot-save-all";
    button.type = "button";
    button.textContent = label;
    button.title = "Save every job on this page to your tracker. The next scan filters and scores them.";
    Object.assign(button.style, {
      position: "fixed", right: "20px", bottom: "20px", zIndex: 2147483647, padding: "10px 16px",
      border: "none", borderRadius: "999px", background: "#2a78d6", color: "#fff", cursor: "pointer",
      font: "600 14px system-ui, sans-serif", boxShadow: "0 6px 20px rgba(0,0,0,.25)",
    });
    button.addEventListener("click", () => saveAll(button));
    document.body.appendChild(button);
  }

  function ensureButton() {
    const s = site();
    const onJob = s && JOB_PAGE[s].test(location.pathname + location.search);
    ensureBulkButton(onJob);
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

  // job sites are single-page apps: re-check when the URL changes, and keep the bulk count current while
  // a search list loads more cards
  let last = "";
  setInterval(() => {
    if (location.href !== last) {
      last = location.href;
      const b = document.getElementById("jobbot-save");
      if (b) b.textContent = "Save job";
      const all = document.getElementById("jobbot-save-all");
      if (all && !bulkBusy) all.remove();
      ensureButton();
    } else {
      const s = site();
      ensureBulkButton(s && JOB_PAGE[s].test(location.pathname + location.search));
    }
  }, 800);
  ensureButton();
})();
