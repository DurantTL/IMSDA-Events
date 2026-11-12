import { describe, expect, it } from "vitest";
import { REPORT_DUE_DAY } from "@/modules/club-reports/domain";
import {
  MONTHLY_RECORD_REMINDER_DAY,
  clubOwesRecord,
  planReminders,
  reminderEmail,
  reminderRecipients,
  reminderWindow,
  summaryEmail,
  turnOnNote,
  type ReminderClub,
} from "@/modules/club-reports/monthly-reminders-domain";

/** #1895: when the Monthly Record reminder is due, who it goes to, and what it says. Synthetic clubs and addresses only. */

describe("reminderWindow", () => {
  it("is due the day after the record is due", () => {
    expect(MONTHLY_RECORD_REMINDER_DAY).toBe(REPORT_DUE_DAY + 1);
  });

  it("is not due on the 1st to the 10th", () => {
    expect(reminderWindow("2026-11-01")).toBeNull();
    expect(reminderWindow("2026-11-10")).toBeNull();
  });

  it("is due on the 11th for the month before", () => {
    expect(reminderWindow("2026-11-11")).toMatchObject({ reportMonth: "2026-10", switchClubYear: "2026-27", reportClubYear: "2026-27" });
  });

  it("is still due later in the month, and only for the month before, never an older one", () => {
    expect(reminderWindow("2026-11-12")?.reportMonth).toBe("2026-10");
    expect(reminderWindow("2026-11-30")?.reportMonth).toBe("2026-10");
  });

  it("crosses the year boundary in January", () => {
    expect(reminderWindow("2027-01-11")?.reportMonth).toBe("2026-12");
  });

  it("reminds about August on September 11, which is the next club year", () => {
    expect(reminderWindow("2027-09-11")).toMatchObject({ reportMonth: "2027-08", switchClubYear: "2027-28", reportClubYear: "2026-27" });
  });

  it("refuses anything that is not a calendar date", () => {
    expect(reminderWindow("11/11/2026")).toBeNull();
    expect(reminderWindow("")).toBeNull();
  });
});

describe("which clubs owe the record", () => {
  const club = (status: ReminderClub["status"], joinedOn: string | null = null): ReminderClub => ({ id: "c", name: "Maple Pathfinders", joinedOn, status });

  it("a missing record and a draft (including a reopened one) are owed; a submitted one is not", () => {
    expect(clubOwesRecord(club(null), "2026-10")).toBe(true);
    expect(clubOwesRecord(club("DRAFT"), "2026-10")).toBe(true);
    expect(clubOwesRecord(club("SUBMITTED"), "2026-10")).toBe(false);
  });

  it("a record submitted once and then reopened is not reminded; a never-submitted draft is", () => {
    expect(clubOwesRecord({ ...club("DRAFT"), everSubmitted: true }, "2026-10")).toBe(false);
    expect(clubOwesRecord({ ...club("DRAFT"), everSubmitted: false }, "2026-10")).toBe(true);
  });

  it("a club that joined after the month with no record owes nothing; with a draft it still does", () => {
    expect(clubOwesRecord(club(null, "2026-11-02"), "2026-10")).toBe(false);
    expect(clubOwesRecord(club("DRAFT", "2026-11-02"), "2026-10")).toBe(true);
    expect(clubOwesRecord(club(null, "2026-10-20"), "2026-10")).toBe(true);
  });
});

describe("reminderRecipients", () => {
  it("keeps directors and deputies with a usable address, once each, and drops everyone else", () => {
    const people = reminderRecipients([
      { role: "DIRECTOR", email: "Dir@Example.test", name: "Dana Director" },
      { role: "DEPUTY", email: "dir@example.test", name: "Dana again" },
      { role: "DEPUTY", email: "deputy@example.test", name: "Dev Deputy" },
      { role: "REGISTRAR", email: "registrar@example.test", name: "Reg" },
      { role: "REPORTER", email: "reporter@example.test", name: "Rep" },
      { role: "DIRECTOR", email: "not an address", name: "Bad" },
      { role: "DEPUTY", email: null, name: "None" },
    ]);
    expect(people).toEqual([
      { email: "deputy@example.test", name: "Dev Deputy" },
      { email: "dir@example.test", name: "Dana Director" },
    ]);
  });
});

describe("planReminders", () => {
  const clubs: ReminderClub[] = [
    { id: "a", name: "Aspen Pathfinders", joinedOn: null, status: null },
    { id: "b", name: "Birch Pathfinders", joinedOn: null, status: "SUBMITTED" },
    { id: "c", name: "Cedar Pathfinders", joinedOn: null, status: "DRAFT" },
    { id: "d", name: "Dogwood Pathfinders", joinedOn: null, status: null },
    { id: "e", name: "Elm Pathfinders", joinedOn: null, status: null },
  ];
  const grant = (email: string) => [{ role: "DIRECTOR" as const, email, name: "Pat Person" }];
  const grantsByClub = new Map([["a", grant("a@example.test")], ["b", grant("b@example.test")], ["c", grant("c@example.test")], ["e", grant("e@example.test")]]);

  it("plans unsubmitted clubs with a recipient that were not already reminded, and nobody else", () => {
    const plan = planReminders({ clubs, reportMonth: "2026-10", alreadyReminded: new Set(["e"]), grantsByClub });
    expect(plan.map((entry) => entry.clubId)).toEqual(["a", "c"]);
  });

  it("plans nothing on a second pass once every club is claimed", () => {
    expect(planReminders({ clubs, reportMonth: "2026-10", alreadyReminded: new Set(["a", "c", "e"]), grantsByClub })).toEqual([]);
  });
});

describe("what the emails say", () => {
  it("names the club and the month and links to the Monthly Record page, and nothing about a child", () => {
    const email = reminderEmail({ directorName: "Pat Person", clubName: "Maple Pathfinders", reportMonth: "2026-10", recordsUrl: "https://events.example.test/account/clubs/club-1/records" });
    expect(email.subject).toBe("Maple Pathfinders: October 2026 Monthly Record is not submitted");
    expect(email.bodyText).toContain("October 2026");
    expect(email.bodyText).toContain("https://events.example.test/account/clubs/club-1/records");
    expect(email.bodyText.startsWith("Hello Pat Person,")).toBe(true);
    expect(email.bodyText).toContain("It was due on November 10.");
  });

  it("gives the coordinator three numbers and no names", () => {
    const email = summaryEmail({ reportMonth: "2026-10", counts: { reminded: 4, submitted: 20, total: 26 } });
    expect(email.bodyText).toContain("Clubs reminded: 4");
    expect(email.bodyText).toContain("Clubs submitted: 20");
    expect(email.bodyText).toContain("Total clubs: 26");
    expect(email.subject).toBe("October 2026 Monthly Records: 4 clubs reminded");
    expect(email.bodyText).toContain("went out this month");
    expect(email.bodyText).not.toContain("today");
  });
});

describe("turnOnNote", () => {
  it("from the 11th, says last month's clubs are emailed on the next scheduled run, with the real dates", () => {
    expect(turnOnNote("2026-11-12")).toBe("If you turn reminders on now, clubs that have not submitted the October 2026 record (due November 10) and haven't been reminded yet are emailed on the next scheduled run.");
  });
  it("before the 11th, says nothing goes out until then", () => {
    expect(turnOnNote("2026-11-05")).toBe("Nothing is sent until the 11th. Then clubs that have not submitted the October 2026 record are emailed on the next scheduled run.");
  });
});
