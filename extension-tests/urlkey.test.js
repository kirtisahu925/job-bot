// Run: cd extension-tests && npm test
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { urlKey, sourceOf } = require("../extension/lib/urlkey.js");

const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "../tests/fixtures/url_keys.json"), "utf8"));

test("url keys match the Python bot for every shared fixture", () => {
  for (const [url, key] of Object.entries(cases)) assert.equal(urlKey(url), key, url);
});

test("source detection", () => {
  assert.equal(sourceOf("https://www.naukri.com/job-listings-x-260926500123"), "naukri");
  assert.equal(sourceOf("https://careers.example.com/jobs/1"), "extension");
  assert.equal(urlKey("not a url"), "");
});
