// Injected on demand (popup "Autofill this page", or auto apply). Fills what it can recognise, highlights it and
// attaches the resume if given. It never submits; content/apply.js decides that. Runs in every frame, so embedded
// ATS iframes work. `root` limits it to one container, such as LinkedIn's Easy Apply dialog.
(function () {
  const { classifyField, matchCustomAnswer, profileValue } = globalThis.JobbotFieldMap;
  const FILLED = "jobbot-filled";

  function labelFor(el) {
    const parts = [];
    if (el.labels) for (const l of el.labels) parts.push(l.innerText);
    const by = el.getAttribute("aria-labelledby");
    if (by) for (const id of by.split(/\s+/)) parts.push(document.getElementById(id)?.innerText || "");
    if (!parts.join("").trim()) {
      // nearest preceding text in the field's container (Workday, custom React forms, chat-style forms)
      let node = el;
      for (let depth = 0; depth < 4 && node && !parts.join("").trim(); depth++) {
        node = node.parentElement;
        const label = node?.querySelector("label, legend, [class*='label'], [data-automation-id*='formLabel']");
        if (label && !label.contains(el)) parts.push(label.innerText);
      }
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function describe(el) {
    return {
      label: labelFor(el),
      name: el.getAttribute("name") || "",
      id: el.id || "",
      placeholder: el.getAttribute("placeholder") || "",
      autocomplete: el.getAttribute("autocomplete") || "",
      ariaLabel: el.getAttribute("aria-label") || "",
      automationId: el.getAttribute("data-automation-id") || "",
      type: el.getAttribute("type") || el.tagName.toLowerCase(),
    };
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  }

  // React/Angular ignore `el.value = x`; use the native setter and fire the events frameworks listen to.
  function setValue(el, value) {
    el.focus();
    if (el.isContentEditable) {
      el.textContent = value;
    } else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function selectOption(el, value) {
    const want = value.toLowerCase();
    const options = [...el.options];
    const match =
      options.find((o) => o.text.trim().toLowerCase() === want) ||
      options.find((o) => o.text.trim().toLowerCase().startsWith(want)) ||
      options.find((o) => want.length > 1 && o.text.toLowerCase().includes(want));
    if (!match) return false;
    el.value = match.value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function mark(el) {
    el.classList.add(FILLED);
    el.style.outline = "2px solid #1baf7a";
    el.style.outlineOffset = "1px";
  }

  // "How many years of experience do you have with Kafka?" asks about one skill, not your career
  const SKILL_YEARS = /\bexperience\b.*\b(with|in|using|on|of)\s+(?!(the )?(industry|field|total|overall|years?)\b)\w/i;

  function answerFor(el, profile, qa, strict) {
    const d = describe(el);
    const key = classifyField(d);
    const question = d.label || d.ariaLabel || d.placeholder;
    const custom = question ? matchCustomAnswer(question, qa) : null;
    // strict (auto apply): a skill-specific years question is answered only from your saved answers
    if (strict && (key === "totalExperience" || key === "relevantExperience") && SKILL_YEARS.test(question || "")) {
      return custom ? { key: "custom", value: custom } : { key: null, value: null, question };
    }
    if (key) return { key, value: profileValue(profile, key), question };
    return custom ? { key: "custom", value: custom } : { key: null, value: null, question };
  }

  function fillRadios(root, profile, qa, report) {
    const groups = new Map();
    for (const r of root.querySelectorAll("input[type=radio]")) {
      if (!r.name || !visible(r)) continue;
      if (!groups.has(r.name)) groups.set(r.name, []);
      groups.get(r.name).push(r);
    }
    const optionText = (r) => (r.labels?.[0]?.innerText || r.value || "").trim().toLowerCase();
    for (const radios of groups.values()) {
      if (radios.some((r) => r.checked)) continue;
      const container = radios[0].closest("fieldset, [role=radiogroup]") || radios[0].parentElement?.parentElement;
      const heading = container?.querySelector("legend, [class*='label'], [class*='question']");
      const question = (heading?.innerText || container?.innerText || "").split("\n")[0].trim();
      // explicit custom answers win over profile-derived ones for yes/no questions
      const key = classifyField({ label: question, name: radios[0].name });
      const value = matchCustomAnswer(question, qa) ?? (key ? profileValue(profile, key) : null);
      if (!value) continue;
      const want = String(value).trim().toLowerCase();
      const pick = radios.find((r) => optionText(r) === want) || radios.find((r) => optionText(r).startsWith(want));
      if (pick) {
        pick.click();
        mark(pick.labels?.[0] || pick);
        report.filled++;
      }
    }
  }

  function attachResume(root, resume, report) {
    if (!resume) return;
    const inputs = [...root.querySelectorAll("input[type=file]")];
    if (!inputs.length) return;
    const target =
      inputs.find((i) => /resume|cv|curriculum/i.test(labelFor(i) + i.name + i.id + (i.getAttribute("aria-label") || ""))) ||
      (inputs.length === 1 ? inputs[0] : null);
    if (!target) return;
    const bytes = Uint8Array.from(atob(resume.base64), (c) => c.charCodeAt(0));
    const file = new File([bytes], resume.name, { type: "application/pdf" });
    const dt = new DataTransfer();
    dt.items.add(file);
    target.files = dt.files;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    mark(target.closest("label, div") || target);
    report.resume = resume.name;
  }

  function run({ profile, customAnswers, resume, root = document, strict = false }) {
    const report = { filled: 0, skipped: 0, unmatched: [], resume: null };
    const fields = root.querySelectorAll(
      "input:not([type=radio]):not([type=checkbox]):not([type=file]), textarea, select, [contenteditable=true]",
    );
    for (const el of fields) {
      if (!visible(el) || el.disabled || el.readOnly) continue;
      const current = el.isContentEditable ? el.textContent : el.value;
      if (current && current.trim() && el.tagName !== "SELECT") {
        report.skipped++;
        continue;
      }
      const { value, question } = answerFor(el, profile, customAnswers, strict);
      if (!value) {
        if (question && (el.required || el.getAttribute("aria-required") === "true")) report.unmatched.push(question.slice(0, 80));
        continue;
      }
      if (el.tagName === "SELECT") {
        if (el.selectedIndex > 0) continue;
        if (!selectOption(el, value)) continue;
      } else {
        setValue(el, value);
      }
      mark(el);
      report.filled++;
    }
    fillRadios(root, profile, customAnswers, report);
    attachResume(root, resume, report);
    return report;
  }

  globalThis.JobbotAutofill = { run, describe, labelFor, visible };
})();
