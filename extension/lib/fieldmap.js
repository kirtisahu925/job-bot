// Decides which profile value a form field wants, from its label, name, id, placeholder, autocomplete,
// aria-label and Workday data-automation-id. Order matters: specific rules come before general ones.
(function (root) {
  const AUTOCOMPLETE = {
    "given-name": "firstName",
    "family-name": "lastName",
    name: "fullName",
    email: "email",
    tel: "phone",
    "tel-national": "phone",
    organization: "currentCompany",
    "organization-title": "currentTitle",
    url: "portfolio",
    "address-level2": "city",
    "country-name": "country",
    country: "country",
    "postal-code": "postalCode",
  };

  // [profile key, pattern]. Tested top to bottom; the first match wins.
  const RULES = [
    ["skip", /\b(cover letter|captcha|password|search|referr(al|er) (code|name|email)|coupon)\b/],
    ["firstName", /\b(first|given|fore) ?name\b/],
    ["lastName", /\b(last|family|sur) ?name\b|\bsurname\b/],
    ["middleName", /\bmiddle name\b/],
    ["email", /\be-?mail\b/],
    ["phoneCountryCode", /\b(country|dial(ing)?) code\b/],
    ["phone", /\b(phone|mobile|cell|contact number|telephone|whatsapp)\b/],
    ["linkedin", /\blinked ?in\b/],
    ["github", /\bgit ?hub\b/],
    ["portfolio", /\b(portfolio|personal (web ?site|site)|web ?site|blog|other links?)\b/],
    ["expectedCtc", /\b(expected|desired) (ctc|salary|compensation|pay)\b|\bsalary expectations?\b/],
    ["currentCtc", /\b(current|present|last drawn) (ctc|salary|compensation|pay)\b|\bctc\b/],
    ["noticePeriod", /\bnotice period\b|\bwhen can you (join|start)\b|\b(earliest )?(joining|start) date\b|\bavailability to join\b/],
    ["relevantExperience", /\brelevant (work )?experience\b/],
    ["totalExperience", /\b(total|overall) (work )?experience\b|\byears of (professional |work )?experience\b|\bexperience (in )?years\b|\bhow many years\b/],
    ["currentTitle", /\b(current|present|most recent) (job )?(title|designation|role|position)\b|\bjob title\b|\bdesignation\b/],
    ["currentCompany", /\b(current|present|most recent) (company|employer|organi[sz]ation)\b|\bcompany name\b|\bemployer\b/],
    ["needsSponsorship", /\bsponsor(ship)?\b/],
    ["workAuthorization", /\b(legally )?authori[sz]ed to work\b|\bwork (authori[sz]ation|permit)\b|\bright to work\b/],
    ["willingToRelocate", /\brelocat/],
    ["gender", /\bgender\b|\bsex\b/],
    ["pronouns", /\bpronouns?\b/],
    ["veteran", /\bveteran\b/],
    ["disability", /\bdisabilit/],
    ["ethnicity", /\b(race|ethnicit)/],
    ["graduationYear", /\b(graduation|passing|passout|pass out) (year|date)\b|\byear of (graduation|passing)\b/],
    ["college", /\b(college|university|school|institute|institution)\b/],
    ["highestEducation", /\b(degree|qualification|education)\b/],
    ["postalCode", /\b(postal|zip|pin) ?code\b|\bpincode\b/],
    ["country", /\bcountry\b/],
    ["currentLocation", /\b(current|present) (city|location)\b|\bwhere are you (based|located)\b|\blocation\b/],
    ["city", /\bcity\b|\btown\b/],
    ["fullName", /\b(full|legal|your|candidate) name\b|^name$/],
  ];

  function normalize(text) {
    return String(text || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_\-.:*?()[\]/]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  /**
   * @param {{label?: string, name?: string, id?: string, placeholder?: string, autocomplete?: string,
   *          ariaLabel?: string, automationId?: string, type?: string}} d
   * @returns {string|null} profile key, or null when unsure
   */
  function classifyField(d) {
    const type = (d.type || "").toLowerCase();
    if (["hidden", "submit", "button", "password", "search", "image", "reset"].includes(type)) return null;
    if (type === "email") return "email";
    if (type === "tel") return "phone";
    const ac = (d.autocomplete || "").toLowerCase().split(/\s+/).pop();
    if (ac && AUTOCOMPLETE[ac]) return AUTOCOMPLETE[ac];
    // the visible label is the best signal; attributes break ties
    for (const source of [d.label, d.ariaLabel, d.placeholder, d.automationId, d.name, d.id]) {
      const text = normalize(source);
      if (!text) continue;
      for (const [key, re] of RULES) {
        if (re.test(text)) return key === "skip" ? null : key;
      }
    }
    return null;
  }

  /** Custom Q&A: lines like "hear about us => LinkedIn". Returns the answer whose keywords all appear. */
  function matchCustomAnswer(question, pairs) {
    const q = normalize(question);
    let best = null;
    for (const { keywords, answer } of pairs || []) {
      const words = normalize(keywords).split(" ").filter(Boolean);
      if (words.length && words.every((w) => q.includes(w)) && (!best || words.length > best.n)) {
        best = { n: words.length, answer };
      }
    }
    return best ? best.answer : null;
  }

  function parseCustomAnswers(text) {
    return String(text || "")
      .split("\n")
      .map((line) => line.split("=>"))
      .filter((parts) => parts.length === 2 && parts[0].trim() && parts[1].trim())
      .map(([k, a]) => ({ keywords: k.trim(), answer: a.trim() }));
  }

  /** Values derived from the profile (full name from first + last, etc.). */
  function profileValue(profile, key) {
    if (!profile) return null;
    if (key === "fullName") return profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(" ");
    if (key === "city") return profile.city || (profile.currentLocation || "").split(",")[0];
    if (key === "currentLocation") return profile.currentLocation || profile.city;
    const v = profile[key];
    return v == null || v === "" ? null : String(v);
  }

  const api = { classifyField, matchCustomAnswer, parseCustomAnswers, profileValue, normalize };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.JobbotFieldMap = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
