import { describe, expect, it } from "vitest";
import { dueLabel, nextStep, statusAfter, type ContactLike, type TouchLike } from "./cadence";
import { formatPhone, normalizePhone, parseContacts, readLabel } from "./parse";
import { leaderSearchLinks, messagesFor, whatsappLink } from "./templates";

describe("parsing pasted contacts", () => {
  it("normalises Indian numbers and spots landlines", () => {
    expect(normalizePhone("+91 98765 43210")).toEqual({ number: "+919876543210", whatsapp: true });
    expect(normalizePhone("9876543210")?.number).toBe("+919876543210");
    expect(normalizePhone("‎+91 80 3533 8377")).toEqual({ number: "+918035338377", whatsapp: false });
    expect(normalizePhone("+971 56 115 1305")).toEqual({ number: "+971561151305", whatsapp: true });
    expect(normalizePhone("12345")).toBeNull();
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
  });

  it("reads person, company, role and city out of a saved label", () => {
    expect(readLabel("Fiserv Noida HR Shivangi")).toMatchObject({ name: "Shivangi", company: { name: "Fiserv" }, location: "Noida" });
    expect(readLabel("Anerican Express HR")).toMatchObject({ name: null, company: { name: "American Express" } });
    expect(readLabel("(HR) Mithun S Oracle Recruiter")).toMatchObject({ name: "Mithun S", company: { name: "Oracle" }, kind: "recruiter" });
    expect(readLabel("Preeti Fynd Consultant")).toMatchObject({ name: "Preeti", company: { name: "Fynd" }, kind: "consultant" });
    expect(readLabel("Akansha JP Morgan Hr Neeraj Team")).toMatchObject({ name: "Akansha", notes: ["Neeraj Team"] });
  });

  it("handles a WhatsApp export: vCards, name/number runs, e-mails, and merges duplicates", () => {
    // made-up people and numbers (+91 98000 0000x is not in use)
    const text = [
      "[17:01] **A Friend:** [Forwarded] [Contact: BEGIN:VCARD",
      "VERSION:3.0",
      "FN:HR Blackrock",
      "TEL;type=Mobile;waid=919800000001:+91 98000 00001",
      "END:VCARD]",
      "[17:01] **A Friend:** [Forwarded] [82 contacts]",
      "[17:01] **A Friend:** [Forwarded] asha.intern@phonepe.com",
      " 9800000002",
      "Ravi Kumar <ravi.k@highradius.com>,",
      "SmartRecruiters <notifications@smartrecruiters.com>,",
      "",
      "Blackrock Hr",
      "+91 98000 00001",
      "HR Phone Pay",
      "\u200e+91 98000 00002",
      "Leadsquared HR",
      "+91 98000 00003",
      "+91 98000 00004",
      "Meera HR",
      "+91 98000 00005",
      "Meera Iyer",
      "Motherson HR",
      "+91 98000 00006",
    ].join("\n");
    const { contacts, skipped } = parseContacts(text);
    const by = (company: string) => contacts.filter((c) => c.company === company);

    expect(by("BlackRock")).toHaveLength(1); // vCard and list entry are one contact
    const phonepe = by("PhonePe");
    expect(phonepe).toHaveLength(1); // the e-mail and the number belong together
    expect(phonepe[0]).toMatchObject({ name: "Asha", emails: ["asha.intern@phonepe.com"] });
    expect(by("LeadSquared")[0].phones.map((p) => p.number)).toEqual(["+919800000003", "+919800000004"]);
    expect(by("HighRadius")[0].name).toBe("Ravi Kumar");
    expect(contacts.find((c) => c.name === "Meera Iyer")).toBeTruthy(); // the WhatsApp name completes "Meera"
    expect(skipped.map((s) => s.value)).toEqual(expect.arrayContaining(["[82 contacts]", "notifications@smartrecruiters.com"]));
  });

  it("reads several addresses on one line, including quoted names with commas", () => {
    const { contacts } = parseContacts('Ravi Kumar <ravi.k@iongroup.com>, hr@definedge.com, "Rao, Asha" <Asha.Rao@finastra.com>');
    expect(contacts.map((c) => [c.company, c.name, c.emails[0]])).toEqual([
      ["Definedge", null, "hr@definedge.com"],
      ["Finastra", "Asha Rao", "asha.rao@finastra.com"],
      ["ION Group", "Ravi Kumar", "ravi.k@iongroup.com"],
    ]);
  });
});

describe("the follow-up rule", () => {
  const now = new Date("2026-09-30T06:00:00Z");
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
  const everyone: ContactLike = {
    name: "Asha Rao",
    company: "Acme",
    status: "reaching_out",
    phones: [{ number: "+919876543210", whatsapp: true }],
    emails: ["asha@acme.example"],
    linkedin_url: null,
  };
  const touch = (channel: TouchLike["channel"], outcome: TouchLike["outcome"], daysAgo: number): TouchLike => ({ channel, outcome, at: at(daysAgo) });

  it("starts on LinkedIn, today", () => {
    const step = nextStep({ ...everyone, status: "new" }, [], now);
    expect(step).toMatchObject({ channel: "linkedin", action: "Send a LinkedIn invite" });
    expect(step.due).toEqual(now);
  });

  it("moves LinkedIn → e-mail → WhatsApp → call, one step every 2-3 days", () => {
    const afterInvite = nextStep(everyone, [touch("linkedin", "invite_sent", 1)], now);
    expect(afterInvite.channel).toBe("email");
    expect(afterInvite.due?.toISOString()).toBe(new Date(Date.parse(at(1)) + 3 * 86_400_000).toISOString()); // an invite gets 3 days
    expect(nextStep(everyone, [touch("linkedin", "invite_sent", 5), touch("email", "sent", 2)], now)).toMatchObject({ channel: "whatsapp", due: now });
    expect(nextStep(everyone, [touch("linkedin", "invite_sent", 7), touch("email", "sent", 4), touch("whatsapp", "sent", 2)], now).channel).toBe("call");
  });

  it("skips channels the contact has no details for", () => {
    // a first name without a company is no LinkedIn search
    expect(nextStep({ ...everyone, company: null, status: "new" }, [], now).channel).toBe("email");
    const phoneOnly: ContactLike = { ...everyone, name: null, emails: [] };
    expect(nextStep({ ...phoneOnly, status: "new" }, [], now).channel).toBe("whatsapp");
    expect(nextStep(phoneOnly, [touch("whatsapp", "sent", 2)], now).channel).toBe("call");
  });

  it("answers today when they reply, then follows up every 2-3 days where they answered", () => {
    expect(nextStep(everyone, [touch("email", "sent", 3), touch("email", "replied", 0)], now)).toMatchObject({ channel: "email", due: now });
    const accepted = nextStep(everyone, [touch("linkedin", "invite_sent", 2), touch("linkedin", "accepted", 0)], now);
    expect(accepted).toMatchObject({ channel: "linkedin", action: "Message them on LinkedIn" });
    const warm = nextStep({ ...everyone, status: "in_touch" }, [touch("whatsapp", "replied", 3), touch("whatsapp", "sent", 1)], now, 3);
    expect(warm).toMatchObject({ channel: "whatsapp", action: "Follow up on WhatsApp" });
    expect(warm.due?.getTime()).toBe(Date.parse(at(1)) + 3 * 86_400_000);
  });

  it("checks in every 2-3 days once an interview is scheduled", () => {
    const step = nextStep({ ...everyone, status: "interviewing" }, [touch("call", "interview", 1)], now);
    expect(step).toMatchObject({ channel: "call", action: "Check in about the interview" });
    expect(step.due?.getTime()).toBe(Date.parse(at(1)) + 2 * 86_400_000);
  });

  it("stops for closed contacts and slows down after two silent rounds", () => {
    expect(nextStep({ ...everyone, status: "closed" }, [], now).channel).toBeNull();
    const silent = ["linkedin", "email", "whatsapp", "call", "linkedin", "email", "whatsapp", "call"].map((ch, i) =>
      touch(ch as TouchLike["channel"], ch === "call" ? "no_answer" : "sent", 20 - i * 2),
    );
    expect(nextStep(everyone, silent, now).why).toMatch(/once a week/);
  });

  it("moves the status along with each outcome", () => {
    expect(statusAfter("new", "invite_sent")).toBe("reaching_out");
    expect(statusAfter("reaching_out", "replied")).toBe("in_touch");
    expect(statusAfter("in_touch", "interview")).toBe("interviewing");
    expect(statusAfter("interviewing", "replied")).toBe("interviewing");
    expect(statusAfter("in_touch", "not_interested")).toBe("closed");
    expect(dueLabel(new Date(now.getTime() - 3 * 86_400_000), now)).toBe("overdue 3d");
    expect(dueLabel(new Date(now.getTime() + 2 * 86_400_000), now)).toBe("in 2d");
  });
});

describe("messages", () => {
  const me = {
    my_name: "Asha Rao",
    my_email: "asha@example.com",
    my_phone: "+91 90000 00000",
    my_linkedin: "https://www.linkedin.com/in/asha",
    headline: "Backend Software Engineer",
    pitch: "a backend engineer with 2 years in Java and Spring Boot",
    target_role: "Backend Engineer (Java)",
    resume_url: null,
  };

  it("keeps the LinkedIn invite note within 300 characters and puts the face-to-face advice in the call notes", () => {
    const list = messagesFor(me, { name: "Priya Sharma", company: "Flipkart", kind: "hr" });
    const invite = list.find((m) => m.label.startsWith("LinkedIn invite"))!;
    expect(invite.body.length).toBeLessThanOrEqual(300);
    expect(invite.body).toMatch(/^Hi Priya, I'm Asha Rao/);
    expect(list.find((m) => m.channel === "call")!.body).toMatch(/face-to-face/);
    expect(list.find((m) => m.channel === "email")!.subject).toMatch(/Flipkart/);
  });

  it("writes to leaders about the company and links their people search", () => {
    const [invite] = messagesFor(me, { name: "Meera Iyer", company: "Qualys", kind: "leader" });
    expect(invite.body).toMatch(/keen on Qualys/);
    expect(leaderSearchLinks("Qualys", "https://www.linkedin.com/company/qualys/")[0].url).toBe(
      "https://www.linkedin.com/company/qualys/people/?keywords=Director",
    );
  });

  it("opens WhatsApp with the text in place", () => {
    expect(whatsappLink("+91 98765 43210", "Hi there")).toBe("https://wa.me/919876543210?text=Hi%20there");
  });
});
