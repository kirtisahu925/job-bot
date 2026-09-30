const $ = (id) => document.getElementById(id);

// [key, label, placeholder] — keys match lib/fieldmap.js
const FIELDS = [
  ["firstName", "First name", ""],
  ["lastName", "Last name", ""],
  ["email", "Email", ""],
  ["phone", "Phone", "e.g. +91 98765 43210"],
  ["phoneCountryCode", "Phone country code", "e.g. +91"],
  ["city", "City", "e.g. Bengaluru"],
  ["currentLocation", "Current location", "e.g. Bengaluru, Karnataka, India"],
  ["country", "Country", "e.g. India"],
  ["postalCode", "PIN code", ""],
  ["linkedin", "LinkedIn URL", "https://linkedin.com/in/…"],
  ["github", "GitHub URL", "https://github.com/…"],
  ["portfolio", "Portfolio / website", ""],
  ["currentCompany", "Current company", ""],
  ["currentTitle", "Current title", "e.g. Software Engineer"],
  ["totalExperience", "Total experience (years)", "e.g. 3"],
  ["relevantExperience", "Relevant experience (years)", "e.g. 3"],
  ["noticePeriod", "Notice period", "e.g. 30 days"],
  ["currentCtc", "Current CTC", "e.g. 8 LPA"],
  ["expectedCtc", "Expected CTC", "e.g. 14 LPA"],
  ["willingToRelocate", "Willing to relocate", "Yes or No"],
  ["workAuthorization", "Authorized to work (India)", "Yes or No"],
  ["needsSponsorship", "Needs visa sponsorship", "Yes or No"],
  ["highestEducation", "Highest degree", "e.g. B.Tech, Computer Science"],
  ["college", "College / university", ""],
  ["graduationYear", "Graduation year", "e.g. 2022"],
  ["gender", "Gender (optional)", "e.g. Prefer not to say"],
  ["veteran", "Veteran status (optional)", "e.g. I am not a protected veteran"],
  ["disability", "Disability (optional)", "e.g. Prefer not to say"],
  ["ethnicity", "Ethnicity (optional)", "e.g. Prefer not to say"],
];

function renderFields(profile) {
  const box = $("profile-fields");
  box.replaceChildren();
  for (const [key, label, placeholder] of FIELDS) {
    const input = Object.assign(document.createElement("input"), { id: `p-${key}`, placeholder, value: profile[key] ?? "" });
    const wrap = document.createElement("label");
    wrap.append(label, input);
    box.append(wrap);
  }
}

// Apply queue settings; defaults and meaning in lib/autoapply.js
const QUEUE_NUMBERS = ["minAts", "minMatch", "dailyCap", "pauseSeconds"];
const SITE_ACCESS = { origins: ["<all_urls>"] };

function renderQueue(saved) {
  const s = globalThis.JobbotAutoApply.settingsOf(saved);
  $("aa-enabled").checked = s.enabled;
  $("aa-linkedin").checked = s.linkedin;
  for (const key of QUEUE_NUMBERS) $(`aa-${key}`).value = s[key];
}

function queueSettings() {
  const numbers = Object.fromEntries(QUEUE_NUMBERS.map((key) => [key, Number($(`aa-${key}`).value)]));
  return { ...numbers, enabled: $("aa-enabled").checked, linkedin: $("aa-linkedin").checked };
}

// Site access must be asked for during the click itself, so it is requested here rather than on Save.
$("aa-enabled").addEventListener("change", async (e) => {
  if (!e.target.checked) return;
  const granted = await chrome.permissions.request(SITE_ACCESS).catch(() => false);
  if (!granted) {
    e.target.checked = false;
    $("aa-status").textContent = "The queue needs access to job sites to open and fill applications; it stays off.";
    return;
  }
  $("aa-status").textContent = "Access granted. Save to turn the queue on.";
});

async function load() {
  const data = await chrome.storage.local.get(["profile", "customAnswers", "supabaseUrl", "anonKey", "defaultResume", "session", "autoApply"]);
  renderFields(data.profile || {});
  renderQueue(data.autoApply);
  $("customAnswers").value = data.customAnswers || "";
  $("supabaseUrl").value = data.supabaseUrl || "";
  $("anonKey").value = data.anonKey || "";
  $("resume-name").textContent = data.defaultResume ? `Current: ${data.defaultResume.name}` : "No default resume";
  $("auth-status").textContent = data.session?.email ? `Signed in as ${data.session.email}` : "Not signed in";
}

$("save").addEventListener("click", async () => {
  const profile = Object.fromEntries(FIELDS.map(([key]) => [key, $(`p-${key}`).value.trim()]));
  const autoApply = queueSettings();
  if (autoApply.enabled && !(await chrome.permissions.contains(SITE_ACCESS))) autoApply.enabled = false;
  await chrome.storage.local.set({ profile, customAnswers: $("customAnswers").value, autoApply });
  renderQueue(autoApply);
  $("save-status").textContent = "Saved";
  setTimeout(() => ($("save-status").textContent = ""), 2000);
});

$("login").addEventListener("click", async () => {
  await chrome.storage.local.set({ supabaseUrl: $("supabaseUrl").value.trim(), anonKey: $("anonKey").value.trim() });
  $("auth-status").textContent = "Signing in…";
  const r = await chrome.runtime.sendMessage({ type: "login", email: $("email").value.trim(), password: $("password").value });
  $("password").value = "";
  $("auth-status").textContent = r.ok ? `Signed in as ${r.email}` : r.error;
});

$("logout").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "logout" });
  $("auth-status").textContent = "Signed out";
});

$("resume-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  await chrome.storage.local.set({ defaultResume: { name: file.name, base64: btoa(binary) } });
  $("resume-name").textContent = `Current: ${file.name}`;
});

load();
