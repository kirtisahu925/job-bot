// Canonical key for a job posting URL. Must match jobbot/pipeline/normalize.py::url_key;
// both are tested against tests/fixtures/url_keys.json.
(function (root) {
  function urlKey(raw) {
    if (!raw) return "";
    let u;
    try {
      u = new URL(raw.trim());
    } catch {
      return "";
    }
    const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    const q = u.searchParams;
    let m;

    if (host.endsWith("linkedin.com")) {
      if (q.get("currentJobId")) return `linkedin:${q.get("currentJobId")}`;
      if ((m = path.match(/\/jobs\/view\/(?:[^/]*?-)?(\d+)/))) return `linkedin:${m[1]}`;
    }
    if (host.endsWith("indeed.com") || `.${host}`.includes(".indeed.")) {
      for (const k of ["jk", "vjk"]) if (q.get(k)) return `indeed:${q.get(k)}`;
    }
    if (host.endsWith("naukri.com") && (m = path.match(/-(\d{6,})$/))) return `naukri:${m[1]}`;
    if (host.endsWith("foundit.in") || host.endsWith("foundit.com")) {
      if ((m = path.match(/-(\d{5,})$/) || path.match(/\/(\d{5,})(?:\/|$)/))) return `foundit:${m[1]}`;
    }
    if ((host.endsWith("wellfound.com") || host.endsWith("angel.co")) && (m = path.match(/\/jobs\/(\d+)/))) {
      return `wellfound:${m[1]}`;
    }
    if (host.includes("greenhouse.io")) {
      if (q.get("gh_jid")) return `greenhouse:${q.get("gh_jid")}`;
      if ((m = path.match(/\/jobs\/(\d+)/))) return `greenhouse:${m[1]}`;
    }
    if (q.get("gh_jid")) return `greenhouse:${q.get("gh_jid")}`;
    if (host === "jobs.lever.co" && (m = path.match(/^\/[^/]+\/([0-9a-f-]{36})/))) return `lever:${m[1]}`;
    if (host === "jobs.ashbyhq.com" && (m = path.match(/^\/[^/]+\/([0-9a-f-]{36})/))) return `ashby:${m[1]}`;
    return `${host}${path}`;
  }

  function sourceOf(raw) {
    const key = urlKey(raw);
    const head = key.split(":")[0];
    return ["linkedin", "indeed", "naukri", "foundit", "wellfound", "greenhouse", "lever", "ashby"].includes(head)
      ? head
      : "extension";
  }

  const api = { urlKey, sourceOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.JobbotUrlKey = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
