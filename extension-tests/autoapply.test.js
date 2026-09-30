const { test } = require("node:test");
const assert = require("node:assert/strict");
const { eligible, istDay, openedToday, pickOutcome, settingsOf } = require("../extension/lib/autoapply.js");

const NOW = Date.parse("2026-09-29T10:00:00Z");
const job = (id, extra = {}) => ({
  id,
  status: "tailored",
  apply_url: `https://jobs.lever.co/acme/${id}`,
  ats_score: 90,
  llm_score: 80,
  ...extra,
});

test("the queue is off until you turn it on, and never has a sending mode", () => {
  const s = settingsOf(undefined);
  assert.equal(s.enabled, false);
  assert.equal(s.linkedin, false);
  assert.equal("mode" in s, false);
});

test("only tailored jobs at or above both minimums, best match first", () => {
  const jobs = [
    job("a", { llm_score: 75 }),
    job("b", { llm_score: 95 }),
    job("low-ats", { ats_score: 79 }),
    job("low-match", { llm_score: 60 }),
    job("not-tailored", { status: "new" }),
    job("applied", { status: "applied" }),
    job("no-link", { apply_url: null }),
    job("do-not-apply", { llm_score: 99, verdict: "skip" }),
  ];
  assert.deepEqual(
    eligible(jobs, { minAts: 80, minMatch: 70 }, {}, NOW).map((j) => j.id),
    ["b", "a"],
  );
});

test("LinkedIn jobs only when allowed", () => {
  const jobs = [job("li", { apply_url: "https://www.linkedin.com/jobs/view/1" }), job("gh")];
  assert.deepEqual(eligible(jobs, {}, {}, NOW).map((j) => j.id), ["gh"]);
  assert.deepEqual(eligible(jobs, { linkedin: true }, {}, NOW).map((j) => j.id).sort(), ["gh", "li"]);
});

test("a job opened recently is not reopened until retryAfterHours passes", () => {
  const tried = { a: new Date(NOW - 2 * 3600e3).toISOString(), b: new Date(NOW - 30 * 3600e3).toISOString() };
  assert.deepEqual(eligible([job("a"), job("b")], {}, tried, NOW).map((j) => j.id), ["b"]);
});

test("the daily limit counts by India date", () => {
  assert.equal(istDay(Date.parse("2026-09-28T18:29:00Z")), "2026-09-28");
  assert.equal(istDay(Date.parse("2026-09-28T18:31:00Z")), "2026-09-29");
  const results = [
    { at: "2026-09-29T01:00:00Z" },
    { at: "2026-09-28T19:00:00Z" }, // 00:30 IST on the 29th
    { at: "2026-09-28T17:00:00Z" }, // 22:30 IST on the 28th
  ];
  assert.equal(openedToday(results, NOW), 2);
});

test("the furthest frame's result counts", () => {
  assert.equal(pickOutcome([null, { state: "no_form" }, { state: "ready", filled: 6 }]).state, "ready");
  assert.equal(pickOutcome([{ state: "needs_you", filled: 2 }, { state: "no_form" }]).state, "needs_you");
  assert.equal(pickOutcome([]).state, "no_form");
});
