import { describe, expect, it } from "vitest";
import { funnel, nextStepFor } from "./applications";
import { boardUrl, countBy, parseBoardUrl, sameCompany } from "./companyMatch";

describe("matching a listed company to job and contact names", () => {
  it("accepts suffixes, spacing and '& Co.', and rejects look-alikes", () => {
    expect(sameCompany("SAP", "SAP Labs India")).toBe(true);
    expect(sameCompany("JPMorgan Chase", "JP Morgan Chase & Co.")).toBe(true);
    expect(sameCompany("Walmart Global Tech", "Walmart")).toBe(true);
    expect(sameCompany("Checkout.com", "Checkout.com")).toBe(true);
    expect(sameCompany("Target", "Targetprocess")).toBe(false);
    expect(sameCompany("American Express", "American Airlines")).toBe(false);
    expect(sameCompany("AMD", "AM Designs")).toBe(false);
  });

  it("counts each job under the company it belongs to", () => {
    const by = countBy(["Google", "Stripe"], [{ c: "Google India" }, { c: "Stripe" }, { c: "Acme" }], (x) => x.c);
    expect(by.get("Google")).toHaveLength(1);
    expect(by.get("Stripe")).toHaveLength(1);
  });

  it("reads and builds job board links", () => {
    expect(parseBoardUrl("https://job-boards.greenhouse.io/remotecom")).toEqual({ board: "greenhouse", slug: "remotecom" });
    expect(parseBoardUrl("https://jobs.lever.co/acme/123")).toEqual({ board: "lever", slug: "acme" });
    expect(parseBoardUrl("https://example.com/careers")).toBeNull();
    expect(boardUrl("ashby", "acme")).toBe("https://jobs.ashbyhq.com/acme");
  });
});

describe("the next step for an application", () => {
  const now = new Date("2026-09-30T06:00:00Z");
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  const job = (status: "applied" | "interviewing" | "offer" | "rejected", d: number) => ({
    status,
    applied_at: daysAgo(d),
    updated_at: daysAgo(d),
    company: "Acme",
  });

  it("waits two days, then follows up every 2-3 days", () => {
    expect(nextStepFor(job("applied", 1), { now }).action).toBe("Wait for a reply");
    const due = nextStepFor(job("applied", 4), { now });
    expect(due.action).toMatch(/Follow up/);
    expect(due.due!.getTime()).toBe(Date.parse(daysAgo(1))); // the day-3 mark
    expect(nextStepFor(job("applied", 6), { now }).due!.getTime()).toBe(now.getTime()); // day 6: today
  });

  it("says yes to face-to-face rounds, and weighs offers against the company's bracket", () => {
    expect(nextStepFor(job("interviewing", 0), { now }).why).toMatch(/face-to-face/);
    expect(nextStepFor(job("offer", 0), { now, bracket: "35–60" }).why).toMatch(/35–60 LPA/);
  });

  it("counts who answered", () => {
    const f = funnel([job("applied", 1), job("interviewing", 1), job("rejected", 1), job("offer", 1)]);
    expect(f).toMatchObject({ total: 4, waiting: 1, heardBack: 3 });
  });
});
