// Reads a job posting from the page the user is on. Tries schema.org JobPosting JSON-LD first (most job
// sites publish it for Google for Jobs), then per-site selectors, then generic page metadata.
(function (root) {
  const SITE_SELECTORS = {
    linkedin: {
      title: [".top-card-layout__title", ".job-details-jobs-unified-top-card__job-title h1", "h1"],
      company: [".topcard__org-name-link", ".job-details-jobs-unified-top-card__company-name a", ".topcard__flavor"],
      location: [".topcard__flavor--bullet", ".job-details-jobs-unified-top-card__primary-description-container span"],
      description: [".show-more-less-html__markup", "#job-details", ".jobs-description__content"],
    },
    naukri: {
      title: ["h1.styles_jd-header-title__rZwM1", "header h1", "h1"],
      company: [".styles_jd-header-comp-name__MvqAI a", "[class*='jd-header-comp-name'] a", "[class*='comp-name']"],
      location: ["[class*='jhc__location'] a", "[class*='location'] a", "[class*='loc']"],
      description: ["[class*='dang-inner-html']", "[class*='job-desc']", "section[class*='JDC']"],
    },
    indeed: {
      title: ["h1[data-testid='jobsearch-JobInfoHeader-title']", ".jobsearch-JobInfoHeader-title", "h1"],
      company: ["[data-testid='inlineHeader-companyName']", "[data-company-name='true']"],
      location: ["[data-testid='inlineHeader-companyLocation']", "[data-testid='job-location']"],
      description: ["#jobDescriptionText"],
    },
    foundit: {
      title: ["h1", ".jdTitle"],
      company: [".jdCompanyName", "[class*='companyName']"],
      location: ["[class*='location']"],
      description: ["#jobDescription", "[class*='jobDescription']", "[class*='jdDescription']"],
    },
    wellfound: {
      title: ["h1"],
      company: ["a[href*='/company/'] h2", "a[href*='/company/']"],
      location: ["[class*='location']"],
      description: ["[class*='description']", "main"],
    },
  };

  function text(el) {
    return el ? (el.innerText || el.textContent || "").replace(/\s+\n/g, "\n").trim() : "";
  }

  function first(doc, selectors) {
    for (const sel of selectors || []) {
      try {
        const el = doc.querySelector(sel);
        if (el && text(el)) return text(el);
      } catch {
        /* invalid selector on this page */
      }
    }
    return "";
  }

  // DOMParser builds an inert document: no scripts run and no images load, unlike innerHTML.
  function decodeOnce(html) {
    return new DOMParser().parseFromString(html, "text/html").body.textContent || "";
  }

  function htmlToText(html) {
    let text = String(html || "");
    // Some sites HTML-escape the markup inside JSON-LD (&lt;p&gt;), so decode until neither tags nor
    // entities remain (bounded, in case the text legitimately contains them).
    for (let pass = 0; pass < 3 && /<[a-z/!]|&(lt|gt|amp|quot|#\d+);/i.test(text); pass++) {
      text = decodeOnce(text.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|div|h\d)>/gi, "\n"));
    }
    return text.replace(/\n{3,}/g, "\n\n").trim();
  }

  function fromJsonLd(doc) {
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(script.textContent);
      } catch {
        continue;
      }
      const items = [].concat(data, data && data["@graph"] ? data["@graph"] : []);
      for (const item of items) {
        if (!item || String(item["@type"]).toLowerCase() !== "jobposting") continue;
        const org = item.hiringOrganization || {};
        const locs = [].concat(item.jobLocation || []).map((l) => {
          const a = (l && l.address) || {};
          return [a.addressLocality, a.addressRegion, a.addressCountry && (a.addressCountry.name || a.addressCountry)]
            .filter(Boolean)
            .join(", ");
        });
        const remote = String(item.jobLocationType || "").toUpperCase().includes("TELECOMMUTE");
        return {
          title: item.title || "",
          company: (typeof org === "string" ? org : org.name) || "",
          location: remote ? `Remote${locs[0] ? `, ${locs[0]}` : ""}` : locs.filter(Boolean).join("; "),
          description: htmlToText(item.description),
        };
      }
    }
    return null;
  }

  function extractJob(doc, site) {
    const ld = fromJsonLd(doc) || {};
    const sel = SITE_SELECTORS[site] || {};
    const meta = (name) => (doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`) || {}).content || "";
    const job = {
      title: ld.title || first(doc, sel.title) || meta("og:title") || doc.title,
      company: ld.company || first(doc, sel.company) || meta("og:site_name"),
      location: ld.location || first(doc, sel.location),
      description: (ld.description && ld.description.length > 200 ? ld.description : "") || first(doc, sel.description) || ld.description || "",
    };
    job.title = job.title.split("\n")[0].trim();
    job.company = job.company.split("\n")[0].trim();
    job.location = job.location.split("\n")[0].trim();
    return job;
  }

  const api = { extractJob, fromJsonLd };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.JobbotExtract = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
