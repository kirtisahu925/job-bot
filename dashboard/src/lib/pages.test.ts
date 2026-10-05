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
    expect(parseBoardUrl("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/x_R1")).toEqual({
      board: "workday",
      slug: "nvidia/wd5/NVIDIAExternalCareerSite",
    });
    expect(boardUrl("workday", "nvidia/wd5/NVIDIAExternalCareerSite")).toBe("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite");
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

describe("the LaTeX quick fix for profile links", () => {
  it("shows LinkedIn and GitHub by name with the address behind them", async () => {
    const { linkProfiles } = await import("./latexEdit");
    const header = String.raw`Gurgaon, India\par
linkedin.com/in/some-one, github.com/some\_one\par
% linkedin.com/in/commented-out
\href{https://github.com/jake}{\underline{github.com/jake}} and \href{https://example.com}{Portfolio}
\url{https://www.linkedin.com/in/url-form}.`;
    const { tex, changed } = linkProfiles(header);
    expect(tex.split("\n")).toEqual([
      String.raw`Gurgaon, India\par`,
      String.raw`\href{https://linkedin.com/in/some-one}{LinkedIn}, \href{https://github.com/some_one}{GitHub}\par`,
      "% linkedin.com/in/commented-out",
      String.raw`\href{https://github.com/jake}{\underline{GitHub}} and \href{https://example.com}{Portfolio}`,
      String.raw`\href{https://linkedin.com/in/url-form}{LinkedIn}.`,
    ]);
    expect(changed).toBe(4);
    expect(linkProfiles(tex).changed).toBe(0); // running it again changes nothing
  });
});

describe("the weekly application review", () => {
  const now = new Date("2026-10-03T06:00:00Z");
  const day = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  let n = 0;
  const app = (status: "applied" | "interviewing" | "rejected", appliedDaysAgo: number, source: string) => ({
    id: `j${++n}`,
    status,
    applied_at: day(appliedDaysAgo),
    updated_at: day(appliedDaysAgo),
    captured_by: "bot",
    job_links: [{ source }],
  });

  it("spots automated screens, reply rates by site and ghosted applications, and never invents a pattern", async () => {
    const { review } = await import("./applications");
    const fastRejected = [app("rejected", 10, "naukri"), app("rejected", 9, "naukri"), app("rejected", 8, "naukri")];
    const linkedin = [app("interviewing", 12, "linkedin"), app("rejected", 12, "linkedin"), app("applied", 4, "linkedin"), app("applied", 3, "linkedin"), app("applied", 2, "linkedin")];
    const quiet = [app("applied", 30, "naukri"), app("applied", 25, "naukri"), app("applied", 22, "naukri"), app("applied", 5, "naukri")];
    const jobs = [...fastRejected, ...linkedin, ...quiet];
    const events = [
      ...fastRejected.map((j) => ({ job_id: j.id, at: new Date(new Date(j.applied_at).getTime() + 86_400_000).toISOString(), to_status: "rejected" as const })),
      { job_id: linkedin[0].id, at: day(5), to_status: "interviewing" as const },
      { job_id: linkedin[1].id, at: day(6), to_status: "interviewing" as const },
      { job_id: linkedin[1].id, at: day(2), to_status: "rejected" as const },
    ];
    const r = review(jobs, events, { now });
    expect(r).toMatchObject({ applied: 12, replies: 5, interviews: 2, ghosted: 3, medianDaysToReply: 1 });
    expect(r.bySource).toEqual([
      { source: "naukri", applied: 7, replies: 3 },
      { source: "linkedin", applied: 5, replies: 2 },
    ]);
    expect(r.findings.join(" ")).toMatch(/3 of your 4 rejections came within 2 days/);
    expect(r.findings.join(" ")).toMatch(/3 applications have had no reply for 3 weeks/);
    expect(review(jobs.slice(0, 2), [], { now }).findings).toEqual(["Too few applications to see a pattern yet. This review fills in as you apply."]);
  });
});
