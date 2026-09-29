// Apply queue rules that need no browser: which jobs qualify, the daily limit, and which frame's result counts.
// Loaded by the service worker (importScripts), the popup, and Node tests. The queue fills applications up to
// their Submit button; you submit each one yourself.
(function (root) {
  const DEFAULTS = {
    enabled: false,
    minAts: 80,
    minMatch: 70,
    dailyCap: 10, // application tabs opened per day
    pauseSeconds: 20, // between jobs, so sites see a person-paced session
    linkedin: false, // LinkedIn Easy Apply; LinkedIn's User Agreement forbids automated use of its site
    retryAfterHours: 24, // a job already opened is not reopened sooner than this
  };

  const LABEL = {
    ready: "Filled up to Submit",
    needs_you: "Needs you",
    external: "Applies on the company site",
    applied_before: "Already applied",
    no_apply: "No apply button",
    no_form: "No application form found",
    error: "Error",
  };

  // States that leave the tab open for you
  const KEEP_TAB = new Set(["ready", "needs_you", "external"]);

  function settingsOf(saved) {
    return { ...DEFAULTS, ...(saved || {}) };
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  const isLinkedIn = (url) => /(^|\.)linkedin\.com$/.test(hostOf(url));

  /** India date, so the daily limit resets at midnight IST, not UTC. */
  function istDay(now = Date.now()) {
    return new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  }

  /**
   * Jobs to open, best match first: a tailored resume, ATS and match at or above the minimums, an apply link,
   * LinkedIn only when allowed, and not opened within `retryAfterHours`.
   */
  function eligible(jobs, settings, tried = {}, now = Date.now()) {
    const s = settingsOf(settings);
    const retryMs = s.retryAfterHours * 3600 * 1000;
    return jobs
      .filter((j) => j.status === "tailored" && j.apply_url)
      .filter((j) => (j.ats_score ?? 0) >= s.minAts && (j.llm_score ?? 0) >= s.minMatch)
      .filter((j) => s.linkedin || !isLinkedIn(j.apply_url))
      .filter((j) => !tried[j.id] || now - Date.parse(tried[j.id]) >= retryMs)
      .sort((a, b) => (b.llm_score ?? 0) - (a.llm_score ?? 0) || (b.ats_score ?? 0) - (a.ats_score ?? 0));
  }

  /** Application tabs the queue opened today (IST). */
  function openedToday(results, now = Date.now()) {
    const day = istDay(now);
    return results.filter((r) => istDay(Date.parse(r.at)) === day).length;
  }

  const RANK = ["ready", "needs_you", "applied_before", "external", "no_apply", "error", "no_form"];

  /** A page runs in every frame (application forms are often iframes); the furthest frame's result counts. */
  function pickOutcome(frameResults) {
    const outcomes = frameResults.filter(Boolean);
    if (!outcomes.length) return { state: "no_form", note: "The page did not answer." };
    const rank = (o) => (RANK.includes(o.state) ? RANK.indexOf(o.state) : RANK.length);
    return [...outcomes].sort((a, b) => rank(a) - rank(b) || (b.filled || 0) - (a.filled || 0))[0];
  }

  const api = { DEFAULTS, LABEL, KEEP_TAB, settingsOf, hostOf, isLinkedIn, istDay, eligible, openedToday, pickOutcome };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.JobbotAutoApply = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
