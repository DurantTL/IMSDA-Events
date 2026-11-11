import { describe, expect, it } from "vitest";
import {
  REMINDER_RECENT_DAYS,
  STERLING_VOLUNTEERS_URL,
  expiryOrMissingText,
  filterRows,
  parseReminderFilter,
  planSterlingReminders,
  reminderCounts,
  reminderStatusText,
  sortFollowUpRows,
  sterlingDirectorEmail,
  sterlingVolunteerEmail,
  type ReminderPerson,
  type SterlingActionRow,
} from "@/modules/background-checks/reminders-domain";

const row = (patch: Partial<SterlingActionRow>): SterlingActionRow => ({
  rosterMemberId: "m1",
  personId: "p1",
  firstName: "Avery",
  lastName: "Testperson",
  name: "Avery Testperson",
  organizationId: "club-1",
  clubName: "Maple Pathfinders",
  role: "Counselor",
  state: "FLAGGED",
  statusText: "Expiring soon",
  expiresOn: null,
  lastRemindedAt: null,
  hasOwnEmail: false,
  personHref: "/admin/organizations/club-1/club#member-m1",
  ...patch,
});

const rows = [
  row({ rosterMemberId: "a", firstName: "Zed", lastName: "Alpha", name: "Zed Alpha", clubName: "Oak", state: "FLAGGED", expiresOn: "2026-12-20" }),
  row({ rosterMemberId: "b", firstName: "Bea", lastName: "Beta", name: "Bea Beta", clubName: "Maple", state: "FLAGGED", expiresOn: "2026-11-30" }),
  row({ rosterMemberId: "c", firstName: "Cy", lastName: "Gamma", name: "Cy Gamma", clubName: "Maple", state: "NOT_COMPLIANT", expiresOn: "2026-10-01" }),
  row({ rosterMemberId: "d", firstName: "Di", lastName: "Delta", name: "Di Delta", clubName: "Birch", state: "NO_RECORD" }),
  row({ rosterMemberId: "e", firstName: "Ed", lastName: "Eps", name: "Ed Eps", clubName: "Birch", state: "CLEAR", expiresOn: "2028-01-01" }),
];

describe("reminder filters and counts (#1844)", () => {
  it("expiring is only the expiring-soon people; not-current is expired, not in compliance and no record; all is everyone", () => {
    expect(filterRows(rows, "expiring").map((r) => r.rosterMemberId)).toEqual(["a", "b"]);
    expect(filterRows(rows, "not-current").map((r) => r.rosterMemberId)).toEqual(["c", "d"]);
    expect(filterRows(rows, "all")).toHaveLength(5);
  });

  it("counts each quick filter and the current people", () => {
    expect(reminderCounts(rows)).toEqual({ expiring: 2, notCurrent: 2, all: 5, current: 1 });
  });

  it("falls back to not-current for anything unknown", () => {
    expect(parseReminderFilter(undefined)).toBe("not-current");
    expect(parseReminderFilter("expiring")).toBe("expiring");
    expect(parseReminderFilter("drop table")).toBe("not-current");
    expect(parseReminderFilter(["all"])).toBe("not-current");
  });

  it("words the status and what is missing", () => {
    expect(reminderStatusText("FLAGGED")).toBe("Expiring soon");
    expect(reminderStatusText("NOT_COMPLIANT")).toBe("Expired or not in compliance");
    expect(reminderStatusText("NO_RECORD")).toBe("No check on file");
    expect(expiryOrMissingText({ state: "FLAGGED", expiresOn: "2026-12-20" })).toBe("2026-12-20");
    expect(expiryOrMissingText({ state: "NO_RECORD", expiresOn: null })).toBe("No check on file");
  });
});

describe("reminder list order (#1844)", () => {
  it("sorts by expiry date with people who have no date last, in both directions", () => {
    expect(sortFollowUpRows(rows, "expires", "asc").map((r) => r.rosterMemberId)).toEqual(["c", "b", "a", "e", "d"]);
    expect(sortFollowUpRows(rows, "expires", "desc").map((r) => r.rosterMemberId)).toEqual(["e", "a", "b", "c", "d"]);
  });

  it("sorts by club then name, and by last name", () => {
    expect(sortFollowUpRows(rows, "club", "asc").map((r) => r.rosterMemberId)).toEqual(["d", "e", "b", "c", "a"]);
    expect(sortFollowUpRows(rows, "name", "asc").map((r) => r.lastName)).toEqual(["Alpha", "Beta", "Delta", "Eps", "Gamma"]);
    expect(sortFollowUpRows(rows, "name", "desc").map((r) => r.lastName)).toEqual(["Gamma", "Eps", "Delta", "Beta", "Alpha"]);
  });
});

describe("reminder email content (#1844)", () => {
  const people = [
    { name: "Avery Testperson", state: "FLAGGED" as const },
    { name: "Blair Samplesmith", state: "NOT_COMPLIANT" as const },
    { name: "Casey Exampleton", state: "NO_RECORD" as const },
  ];

  it("tells a director who is expiring soon and who is not current, with the Sterling link and the club page", () => {
    const email = sterlingDirectorEmail({ directorName: "Dana Director", clubName: "Maple Pathfinders", people, clubUrl: "https://events.example.test/account/clubs/club-1" });
    expect(email.subject).toBe("Sterling Volunteers checks to follow up for Maple Pathfinders");
    expect(email.bodyText).toContain("Hi Dana,");
    expect(email.bodyText).toMatch(/Expiring soon\n- Avery Testperson/);
    expect(email.bodyText).toMatch(/Not current\n- Blair Samplesmith\n- Casey Exampleton/);
    expect(email.bodyText).toContain(STERLING_VOLUNTEERS_URL);
    expect(email.bodyText).toContain("https://events.example.test/account/clubs/club-1");
    expect(email.bodyText).toMatch(/IMAdventist$/);
  });

  it("carries no date, note or issue wording, for a director or a volunteer", () => {
    const director = sterlingDirectorEmail({ directorName: "Dana Director", clubName: "Maple Pathfinders", people, clubUrl: "https://events.example.test/account/clubs/club-1" }).bodyText;
    const volunteer = sterlingVolunteerEmail({ name: "Avery Testperson", clubName: "Maple Pathfinders", state: "NOT_COMPLIANT" }).bodyText;
    for (const text of [director, volunteer]) {
      expect(text).not.toMatch(/\b20\d{2}\b/);
      expect(text).not.toMatch(/\d{1,2}\/\d{1,2}/);
      expect(text).not.toMatch(/issue|note|reason|report|expired on|expires on|non-driver/i);
    }
  });

  it("tells a volunteer only about themselves", () => {
    const soon = sterlingVolunteerEmail({ name: "Avery Testperson", clubName: "Maple Pathfinders", state: "FLAGGED" });
    expect(soon.bodyText).toContain("is expiring soon");
    expect(soon.bodyText).toContain(STERLING_VOLUNTEERS_URL);
    expect(soon.bodyText).not.toContain("Blair");
    expect(sterlingVolunteerEmail({ name: "Avery Testperson", clubName: "Maple Pathfinders", state: "NO_RECORD" }).bodyText).toContain("is not current");
  });

  it("uses a recent-days window of a week", () => {
    expect(REMINDER_RECENT_DAYS).toBe(7);
  });
});

describe("who gets which reminder (#1844)", () => {
  const person = (patch: Partial<ReminderPerson>): ReminderPerson => ({
    rosterMemberId: "m1", personId: "p1", name: "Avery Testperson", organizationId: "club-1", clubName: "Maple Pathfinders", state: "FLAGGED", ownEmail: null, ...patch,
  });
  const clubUrl = (id: string) => `https://events.example.test/account/clubs/${id}`;

  it("sends one email per director per club listing that club's people", () => {
    const plan = planSterlingReminders({
      people: [person({}), person({ rosterMemberId: "m2", personId: "p2", name: "Blair Samplesmith", state: "NO_RECORD" }), person({ rosterMemberId: "m3", personId: "p3", name: "Casey Exampleton", organizationId: "club-2", clubName: "Oak Adventurers" })],
      directorsByClub: new Map([
        ["club-1", [{ email: "dana@example.test", name: "Dana Director" }, { email: "Dee@example.test", name: "Dee Director" }]],
        ["club-2", [{ email: "dana@example.test", name: "Dana Director" }]],
      ]),
      clubUrl,
    });
    const director = plan.messages.filter((m) => m.kind === "DIRECTOR");
    expect(director.map((m) => `${m.organizationId}:${m.to.email}`)).toEqual(["club-1:dana@example.test", "club-1:dee@example.test", "club-2:dana@example.test"]);
    expect(director[0]!.bodyText).toContain("Avery Testperson");
    expect(director[0]!.bodyText).toContain("Blair Samplesmith");
    expect(director[0]!.bodyText).not.toContain("Casey");
    expect(director[2]!.bodyText).toContain("Casey Exampleton");
    expect(director[0]!.recipientLabel).toBe("Director of Maple Pathfinders");
    expect(plan.noRecipient).toEqual([]);
    expect(plan.directorOnly).toBe(3);
  });

  it("dedupes a director address written two ways and emails the volunteer too when an address is on file", () => {
    const plan = planSterlingReminders({
      people: [person({ ownEmail: "AVERY@example.test" })],
      directorsByClub: new Map([["club-1", [{ email: "dana@example.test", name: "Dana" }, { email: "DANA@example.test", name: "Dana Again" }]]]),
      clubUrl,
    });
    expect(plan.messages.map((m) => m.to.email)).toEqual(["dana@example.test", "avery@example.test"]);
    expect(plan.messages[1]!.recipientLabel).toBe("Volunteer");
    expect(plan.outcomes[0]).toMatchObject({ directorRecipients: 1, volunteerEmailed: true });
    expect(plan.directorOnly).toBe(0);
  });

  it("gives a volunteer who is also a director of their club only the director email", () => {
    const plan = planSterlingReminders({
      people: [person({ ownEmail: "Dana@Example.test", name: "Dana Director" })],
      directorsByClub: new Map([["club-1", [{ email: "dana@example.test", name: "Dana Director" }]]]),
      clubUrl,
    });
    expect(plan.messages).toHaveLength(1);
    expect(plan.messages[0]!.kind).toBe("DIRECTOR");
    expect(plan.outcomes[0]).toMatchObject({ volunteerEmailed: false, directorRecipients: 1 });
  });

  it("lists a person with no director and no address separately, and emails only the volunteer when there is no director", () => {
    const plan = planSterlingReminders({
      people: [person({}), person({ rosterMemberId: "m2", personId: "p2", name: "Blair Samplesmith", ownEmail: "blair@example.test" })],
      directorsByClub: new Map(),
      clubUrl,
    });
    expect(plan.noRecipient.map((p) => p.name)).toEqual(["Avery Testperson"]);
    expect(plan.messages.map((m) => m.to.email)).toEqual(["blair@example.test"]);
  });

  it("sends a person who is on two club rosters one email of their own", () => {
    const plan = planSterlingReminders({
      people: [person({ ownEmail: "avery@example.test" }), person({ rosterMemberId: "m9", organizationId: "club-2", clubName: "Oak Adventurers", ownEmail: "avery@example.test" })],
      directorsByClub: new Map(),
      clubUrl,
    });
    expect(plan.messages).toHaveLength(1);
    expect(plan.messages[0]!.rosterMemberIds).toEqual(["m1", "m9"]);
    expect(plan.outcomes.every((o) => o.volunteerEmailed)).toBe(true);
  });
});
