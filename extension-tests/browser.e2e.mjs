// Browser tests: autofill + extraction against local fixtures, and loading the unpacked extension.
//   cd extension-tests && npm install && npx playwright install chromium && npm run test:browser
// Set CHROMIUM_PATH to use an already installed Chromium instead.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const ext = path.resolve(here, "../extension");
const fixture = (name) => pathToFileURL(path.join(here, "fixtures", name)).href;
const executablePath = process.env.CHROMIUM_PATH || undefined;

const profile = {
  firstName: "Asha",
  lastName: "Rao",
  email: "asha@example.com",
  phone: "+91 90000 00000",
  city: "Gurugram",
  linkedin: "https://linkedin.com/in/asha",
  currentCtc: "8 LPA",
  noticePeriod: "30 days",
  workAuthorization: "Yes",
  needsSponsorship: "No",
  gender: "Prefer not to say",
};
const customAnswers = [{ keywords: "hear about", answer: "LinkedIn" }];
const resume = { name: "Asha_Rao_Resume.pdf", base64: Buffer.from("%PDF-1.4 test").toString("base64") };

async function inject(page) {
  for (const f of ["lib/fieldmap.js", "content/autofill.js", "lib/extract.js", "lib/urlkey.js"]) {
    await page.addScriptTag({ path: path.join(ext, f) });
  }
}

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.log(`not ok - ${name}\n  ${err.message.split("\n").join("\n  ")}`);
  }
}

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();

await check("greenhouse-style form is filled, resume attached, nothing submitted", async () => {
  await page.goto(fixture("greenhouse_form.html"));
  await inject(page);
  const report = await page.evaluate((p) => globalThis.JobbotAutofill.run(p), { profile, customAnswers, resume });
  const val = (sel) => page.inputValue(sel);
  assert.equal(await val("#first_name"), "Asha");
  assert.equal(await val("#last_name"), "Rao");
  assert.equal(await val("#email"), "asha@example.com");
  assert.equal(await val("#phone"), "+91 90000 00000");
  assert.equal(await val("#q1"), "https://linkedin.com/in/asha");
  assert.equal(await val("#q2"), "8 LPA");
  assert.equal(await page.$eval("#q3", (s) => s.options[s.selectedIndex].text), "30 days");
  assert.equal(await val("#q4"), "LinkedIn");
  assert.equal(await val("#q5"), "", "free-text motivation is left for the candidate");
  assert.equal(await page.$eval("#gender", (s) => s.options[s.selectedIndex].text), "Prefer not to say");
  assert.equal(await page.isChecked("input[name=auth][value=yes]"), true);
  assert.equal(await page.isChecked("input[name=sponsor][value=no]"), true);
  assert.equal(await page.isChecked("#consent"), false, "consent boxes are never ticked");
  assert.equal(await page.$eval("#resume", (i) => i.files[0]?.name), "Asha_Rao_Resume.pdf");
  assert.equal(report.resume, "Asha_Rao_Resume.pdf");
  assert.ok(report.unmatched.some((q) => q.startsWith("Why do you want")), "required unknown question is reported");
  assert.equal(await page.evaluate(() => window.__submitted ?? false), false);
});

await check("workday-style fields via automation ids, React input events, prefilled values kept", async () => {
  await page.goto(fixture("workday_form.html"));
  await inject(page);
  await page.evaluate((p) => globalThis.JobbotAutofill.run(p), { profile, customAnswers, resume: null });
  assert.equal(await page.inputValue("[data-automation-id=legalNameSection_firstName]"), "Asha");
  assert.equal(await page.inputValue("[data-automation-id=legalNameSection_lastName]"), "Rao");
  assert.equal(await page.inputValue("[data-automation-id=email]"), "asha@example.com");
  assert.equal(await page.inputValue("[data-automation-id=phone-number]"), "+91 90000 00000");
  assert.equal(await page.evaluate(() => window.__reactCity), "Gurugram", "input event reached the framework");
  assert.equal(await page.inputValue("#prefilled"), "keep me");
});

await check("LinkedIn job page is read from JSON-LD", async () => {
  await page.goto(fixture("linkedin_job.html"));
  await inject(page);
  const job = await page.evaluate(() => globalThis.JobbotExtract.extractJob(document, "linkedin"));
  assert.equal(job.title, "Backend Engineer (SDE-2), Payments");
  assert.equal(job.company, "Acme Fintech");
  assert.equal(job.location, "Bengaluru, Karnataka, IN");
  assert.match(job.description, /Spring Boot services for payments/);
  assert.doesNotMatch(job.description, /<p>|<strong>/);
});

await check("Naukri job page falls back to selectors", async () => {
  await page.goto(fixture("naukri_job.html"));
  await inject(page);
  const job = await page.evaluate(() => globalThis.JobbotExtract.extractJob(document, "naukri"));
  assert.equal(job.title, "Python Developer");
  assert.equal(job.company, "Orbit Labs");
  assert.equal(job.location, "Gurugram");
  assert.match(job.description, /FastAPI and Django/);
});
await browser.close();

await check("unpacked extension loads: service worker, popup and options render", async () => {
  const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "jobbot-ext-")), {
    executablePath,
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  let [worker] = context.serviceWorkers();
  worker = worker || (await context.waitForEvent("serviceworker", { timeout: 15000 }));
  const id = new URL(worker.url()).host;
  const errors = [];
  const popup = await context.newPage();
  popup.on("pageerror", (e) => errors.push(e.message));
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForTimeout(500);
  assert.match(await popup.textContent("#account"), /Not connected to Supabase yet/);
  const options = await context.newPage();
  options.on("pageerror", (e) => errors.push(e.message));
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.fill("#p-firstName", "Asha");
  await options.click("#save");
  const stored = await options.evaluate(() => chrome.storage.local.get("profile"));
  assert.equal(stored.profile.firstName, "Asha");
  assert.deepEqual(errors, []);
  await context.close();
});

console.log(failures ? `\n${failures} failed` : "\nall browser tests passed");
process.exit(failures ? 1 : 0);
