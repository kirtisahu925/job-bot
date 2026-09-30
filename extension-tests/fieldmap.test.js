const { test } = require("node:test");
const assert = require("node:assert/strict");
const { classifyField, matchCustomAnswer, parseCustomAnswers, profileValue } = require("../extension/lib/fieldmap.js");

const cases = [
  [{ label: "First Name *" }, "firstName"],
  [{ label: "Last name" }, "lastName"],
  [{ name: "job_application[first_name]" }, "firstName"],
  [{ automationId: "legalNameSection_firstName" }, "firstName"],
  [{ automationId: "legalNameSection_lastName" }, "lastName"],
  [{ label: "Full Name" }, "fullName"],
  [{ label: "Name" }, "fullName"],
  [{ type: "email", name: "x" }, "email"],
  [{ label: "Mobile Number" }, "phone"],
  [{ autocomplete: "tel" }, "phone"],
  [{ label: "LinkedIn Profile" }, "linkedin"],
  [{ label: "GitHub URL" }, "github"],
  [{ label: "Portfolio / Website" }, "portfolio"],
  [{ label: "Current CTC (in LPA)" }, "currentCtc"],
  [{ label: "Expected CTC" }, "expectedCtc"],
  [{ label: "What are your salary expectations?" }, "expectedCtc"],
  [{ label: "Notice Period" }, "noticePeriod"],
  [{ label: "How many years of experience do you have with Java?" }, "totalExperience"],
  [{ label: "Relevant experience" }, "relevantExperience"],
  [{ label: "Current Company" }, "currentCompany"],
  [{ label: "Current Designation" }, "currentTitle"],
  [{ label: "Are you legally authorized to work in India?" }, "workAuthorization"],
  [{ label: "Will you now or in the future require sponsorship?" }, "needsSponsorship"],
  [{ label: "Are you willing to relocate to Bengaluru?" }, "willingToRelocate"],
  [{ label: "Current Location" }, "currentLocation"],
  [{ label: "City" }, "city"],
  [{ label: "Gender" }, "gender"],
  [{ label: "Year of passing" }, "graduationYear"],
  [{ label: "College/University" }, "college"],
  [{ label: "Cover Letter" }, "coverLetter"],
  [{ label: "Password", type: "password" }, null],
  [{ label: "Why do you want to work here?" }, null],
];

test("classifies common application fields", () => {
  for (const [descriptor, expected] of cases) {
    assert.equal(classifyField(descriptor), expected, JSON.stringify(descriptor));
  }
});

test("custom answers: all keywords must appear, the most specific wins", () => {
  const pairs = parseCustomAnswers("hear about => LinkedIn\nwork => generic\nauthorized to work in India => Yes\nbad line");
  assert.equal(pairs.length, 3);
  assert.equal(matchCustomAnswer("How did you hear about us?", pairs), "LinkedIn");
  assert.equal(matchCustomAnswer("Are you authorized to work in India?", pairs), "Yes");
  assert.equal(matchCustomAnswer("Favourite colour?", pairs), null);
});

test("derived profile values", () => {
  const p = { firstName: "Asha", lastName: "Rao", currentLocation: "Gurugram, Haryana" };
  assert.equal(profileValue(p, "fullName"), "Asha Rao");
  assert.equal(profileValue(p, "city"), "Gurugram");
  // a cover-letter box is filled only with the letter saved for this job
  assert.equal(profileValue(p, "coverLetter"), null);
  assert.equal(profileValue({ ...p, coverLetter: "Dear Hiring Team," }, "coverLetter"), "Dear Hiring Team,");
  assert.equal(profileValue(p, "github"), null);
});
