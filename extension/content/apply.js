// Apply queue, one page. Injected after lib/fieldmap.js and content/autofill.js, in every frame.
// It fills the application from your profile and saved answers, moves through multi-step forms with their
// Next / Continue buttons, and stops when it reaches the Submit button. It never presses Submit: you review
// the tab and send it yourself. It never guesses an answer, never writes free text, and never ticks consent
// boxes; anything like that stops it early with "needs you".
(function () {
  const { run: fill, labelFor, visible } = globalThis.JobbotAutofill;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const textOf = (el) => squash(el?.innerText || el?.value || el?.getAttribute?.("aria-label") || "");

  // Step buttons only. A bare "Continue" or "Proceed" is left out: some sites use it for the final send.
  const NEXT = /^(next|next step|save (and|&) continue|continue to next step|review|review (your |my )?application)$/i;
  const SEND = /^(submit|submit (your |my )?application|send (your |my )?application|apply|apply now|finish|complete application)$/i;
  const ERRORS = "[role=alert], .error, .errors, .field-error, .invalid-feedback, .artdeco-inline-feedback--error, [aria-invalid=true]";
  const MAX_STEPS = 12;

  async function waitFor(fn, ms = 8000, step = 250) {
    for (let waited = 0; waited < ms; waited += step) {
      const value = fn();
      if (value) return value;
      await sleep(step);
    }
    return fn();
  }

  function questionOf(el) {
    return squash(labelFor(el) || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.name).slice(0, 90);
  }

  /** Required fields still empty after filling: the page's own `required`, plus aria-required custom widgets. */
  function missingRequired(root) {
    const missing = [];
    const radios = new Set();
    for (const el of root.querySelectorAll("input, textarea, select")) {
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (el.disabled || ["hidden", "submit", "button"].includes(type)) continue;
      if (!(el.required || el.getAttribute("aria-required") === "true")) continue;
      if (type !== "file" && !visible(el)) continue;
      if (type === "radio") {
        if (radios.has(el.name)) continue;
        radios.add(el.name);
        const group = root.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`);
        if (![...group].some((r) => r.checked)) missing.push(questionOf(el.closest("fieldset") || el));
      } else if (type === "checkbox") {
        if (!el.checked) missing.push(questionOf(el)); // consent and declarations are yours to tick
      } else if (type === "file") {
        if (!el.files?.length) missing.push(questionOf(el) || "File upload");
      } else if (!squash(el.value)) {
        missing.push(questionOf(el));
      }
    }
    return missing.filter(Boolean);
  }

  function visibleErrors(root) {
    return [...root.querySelectorAll(ERRORS)]
      .filter((el) => visible(el) && squash(el.innerText))
      .map((el) => squash(el.innerText).slice(0, 120));
  }

  function button(root, pattern) {
    const candidates = [...root.querySelectorAll("button, input[type=submit], [role=button]")].filter(
      (b) => visible(b) && !b.disabled && b.getAttribute("aria-disabled") !== "true",
    );
    const matches = (b) => pattern.test(textOf(b)) || pattern.test(squash(b.getAttribute("aria-label")));
    return candidates.find((b) => b.type === "submit" && matches(b)) || candidates.find(matches);
  }

  /** The form that holds the application: the one with the most fields we filled. */
  function applicationRoot() {
    let best = null;
    let bestCount = 0;
    for (const form of document.forms) {
      const count = form.querySelectorAll(".jobbot-filled").length;
      if (count > bestCount) [best, bestCount] = [form, count];
    }
    return best || document;
  }

  function outcome(state, note, extra = {}) {
    return { state, note, url: location.href, frame: window === top ? "top" : "iframe", ...extra };
  }

  function stopFor(missing, errors, report) {
    const why = [...new Set([...missing, ...errors])].slice(0, 6);
    return outcome("needs_you", why.length ? `Needs: ${why.join("; ")}` : "Needs a look", { filled: report.filled, missing: why });
  }

  // Marks the Submit button so it is easy to find when you open the tab.
  function point(send) {
    send.style.outline = "3px solid #1baf7a";
    send.style.outlineOffset = "2px";
    send.scrollIntoView({ block: "center" });
  }

  /** Walks a form step by step (single page, or multi-step like Workday and LinkedIn's dialog) up to Submit. */
  async function walk(getRoot, { profile, customAnswers, resume }, isApplication) {
    let report = { filled: 0, unmatched: [], resume: null };
    let attached = null;
    for (let step = 0; step < MAX_STEPS; step++) {
      const scope = getRoot();
      if (!scope) return outcome("needs_you", "The application closed.", { filled: report.filled });
      const r = fill({ profile, customAnswers, resume: attached ? null : resume, root: scope, strict: true });
      attached = attached || r.resume;
      report = { filled: report.filled + r.filled, unmatched: r.unmatched, resume: attached };
      const root = scope === document ? applicationRoot() : scope;
      if (!isApplication(root, report)) return outcome("no_form", "No application form on this page.", { filled: report.filled });

      const missing = [...new Set([...r.unmatched, ...missingRequired(root)])];
      if (missing.length) return stopFor(missing, [], report);

      const send = button(root, SEND);
      if (send) {
        point(send);
        return outcome("ready", "Filled up to Submit. Review it and press Submit yourself.", { filled: report.filled, resume: attached });
      }

      const next = button(root, NEXT);
      if (!next) return outcome("needs_you", "Could not find the Next or Submit button.", { filled: report.filled });
      const marker = squash(root.innerText).slice(0, 400);
      next.click();
      // the step changed, or the page complained about something we could not answer
      await waitFor(() => squash(getRoot()?.innerText || "").slice(0, 400) !== marker || visibleErrors(root).length, 6000);
      await sleep(600);
      const errors = visibleErrors(getRoot() || root);
      if (errors.length) return stopFor([], errors, report);
    }
    return outcome("needs_you", `Did not reach Submit after ${MAX_STEPS} steps.`, { filled: report.filled });
  }

  // ---- LinkedIn Easy Apply ---------------------------------------------------------------------------------
  const DIALOG = ".jobs-easy-apply-modal, [data-test-modal-id='easy-apply-modal'], div[role=dialog][aria-labelledby*='apply']";

  function easyApplyDialog() {
    const dialog = [...document.querySelectorAll(DIALOG)].find(visible);
    return dialog || [...document.querySelectorAll("[role=dialog]")].find((d) => visible(d) && d.querySelector("form, input, select"));
  }

  async function linkedin(payload) {
    const apply = await waitFor(
      () => [...document.querySelectorAll("button.jobs-apply-button, button[aria-label*='Apply' i]")].find(visible),
      10000,
    );
    if (!apply) {
      const top = document.querySelector(".jobs-unified-top-card, .job-details-jobs-unified-top-card__container--two-pane, main");
      const applied = /\bapplied\b/i.test(squash(top?.innerText));
      return outcome(applied ? "applied_before" : "no_apply", applied ? "You already applied on LinkedIn." : "No apply button (the job may be closed).");
    }
    if (!/easy apply/i.test(`${textOf(apply)} ${apply.getAttribute("aria-label") || ""}`)) {
      return outcome("external", "This job applies on the company's own site; use Apply on the LinkedIn page.");
    }
    apply.click();
    if (!(await waitFor(easyApplyDialog, 8000))) return outcome("needs_you", "The Easy Apply dialog did not open.");
    return walk(easyApplyDialog, payload, () => true);
  }

  async function run(payload) {
    try {
      if (/(^|\.)linkedin\.com$/.test(location.hostname)) {
        return window === top ? await linkedin(payload) : null;
      }
      // wait for client-rendered forms to appear
      await waitFor(() => document.querySelector("input, textarea, select"), 8000);
      // an application has a resume upload or several fields we recognised (a newsletter box has one or two)
      return await walk(() => document, payload, (root, report) =>
        !!(report.resume || report.filled >= 3 || root.querySelector("input[type=file]")),
      );
    } catch (err) {
      return outcome("error", String(err?.message || err).slice(0, 200));
    }
  }

  globalThis.JobbotApply = { run, missingRequired, button, NEXT, SEND };
})();
