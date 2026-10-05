// Reads the job cards on a job site's search results page, for "Save N jobs from this page". Naukri for
// now: it blocks the bot's servers, but this runs in your own browser on the page you have open.
// Class names on job sites change often, so cards are found from their job links and read with loose
// selectors (any class containing "comp-name", "locWdth" and so on).
(function (root) {
  const CARD = {
    naukri: {
      link: 'a[href*="/job-listings-"]',
      company: ["[class*='comp-name']", "a[href*='-jobs-careers-']", "[class*='companyInfo'] a"],
      location: ["[class*='locWdth']", "[class*='loc-wrap']", "[class*='location']"],
      experience: ["[class*='expwdth']", "[class*='exp-wrap']", "[class*='experience']"],
      snippet: ["[class*='job-desc']", "[class*='job-description']"],
      skills: "[class*='tags'] li",
      posted: ["[class*='job-post-day']", "[class*='post-day']", "[class*='postedDate']"],
    },
  };

  function text(el) {
    return el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "";
  }

  function pick(card, selectors) {
    for (const sel of selectors) {
      const el = card.querySelector(sel);
      if (text(el)) return text(el);
    }
    return "";
  }

  const jobPath = (href, base) => {
    try {
      return new URL(href, base).pathname;
    } catch {
      return href;
    }
  };

  /** The smallest element around the job link that also holds a company name: the card. Climbing stops at
   * the first element that holds a second job, which is the list, so a card without a company is skipped
   * rather than given its neighbour's. */
  function cardOf(link, conf) {
    const own = jobPath(link.getAttribute("href"), link.baseURI);
    let el = link;
    for (let i = 0; i < 8 && el.parentElement; i++) {
      el = el.parentElement;
      const jobs = new Set([...el.querySelectorAll(conf.link)].map((a) => jobPath(a.getAttribute("href"), a.baseURI)));
      if (jobs.size > 1 || !jobs.has(own)) return null;
      if (conf.company.some((sel) => el.querySelector(sel))) return el;
    }
    return null;
  }

  /** "3 Days Ago", "Just Now", "30+ Days Ago" as an ISO date; "30+" counts as 31 days. */
  function parsePosted(value, now = new Date()) {
    const t = String(value || "").toLowerCase();
    if (!t) return null;
    const ago = (days) => new Date(now.getTime() - days * 86400000).toISOString();
    if (/just now|few hours|today|hour|minute|second/.test(t)) return ago(0);
    let m;
    if ((m = t.match(/(\d+)\s*(\+)?\s*day/))) return ago(Number(m[1]) + (m[2] ? 1 : 0));
    if ((m = t.match(/(\d+)\s*(\+)?\s*week/))) return ago(Number(m[1]) * 7 + (m[2] ? 1 : 0));
    if ((m = t.match(/(\d+)\s*(\+)?\s*month/))) return ago(Number(m[1]) * 30 + (m[2] ? 1 : 0));
    return null;
  }

  /** Every job card on the page: {url, title, company, location, experience, snippet, skills, posted_at}. */
  function listJobs(doc, site, now = new Date()) {
    const conf = CARD[site];
    if (!conf) return [];
    const seen = new Set();
    const out = [];
    for (const link of doc.querySelectorAll(conf.link)) {
      let url;
      try {
        url = new URL(link.getAttribute("href"), doc.baseURI);
      } catch {
        continue;
      }
      url.search = "";
      url.hash = "";
      if (seen.has(url.href)) continue;
      const card = cardOf(link, conf);
      if (!card) continue;
      const title = (link.getAttribute("title") || text(link)).trim();
      const company = pick(card, conf.company);
      if (!title || !company) continue;
      seen.add(url.href);
      out.push({
        url: url.href,
        title,
        company,
        location: pick(card, conf.location),
        experience: pick(card, conf.experience),
        snippet: pick(card, conf.snippet),
        skills: [...card.querySelectorAll(conf.skills)].map(text).filter(Boolean),
        posted_at: parsePosted(pick(card, conf.posted), now),
      });
    }
    return out;
  }

  const api = { listJobs, parsePosted };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.JobbotListing = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
