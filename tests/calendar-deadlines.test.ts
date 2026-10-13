import { describe, expect, it } from "vitest";
import { calendarDateIn } from "@/modules/calendar/domain";
import {
  autoEntryType,
  buildDeadlineReminderEmail,
  daysUntil,
  deadlineWindow,
  dueLabel,
  refreshedEntryType,
  reminderDate,
  reminderPointFor,
  singleLine,
  sortDeadlineItems,
  titleSaysDue,
  toDeadlineListItem,
} from "@/modules/calendar/deadlines";

describe("which imported titles are deadlines (#910)", () => {
  it.each([
    // The examples from the issue.
    "Spring Camporee Registration Due",
    "All points and Investiture Reports are Due",
    "Pathfinder and TLT of the Year Nominations Due",
    // Other clear wordings.
    "Forms due",
    "Reports are due",
    "DUE: Points report",
    "Camporee Registration Deadline",
    "Nomination deadlines",
    "Honors due to the conference office by Friday",
  ])("marks %j as a deadline", (title) => {
    expect(titleSaysDue(title)).toBe(true);
    expect(autoEntryType(title, "STANDARD")).toBe("DEADLINE");
  });

  it.each([
    "Spring Camporee",
    "Pathfinder Bible Experience",
    "Overdue notices go out",
    "Annual Dues Payment",
    "Residue workshop",
    "Conference office closed due to weather",
    "Camporee postponed due to snow",
    "Event cancelled due to low enrollment",
    "",
  ])("leaves %j an ordinary entry", (title) => {
    expect(titleSaysDue(title)).toBe(false);
    expect(autoEntryType(title, "STANDARD")).toBe("STANDARD");
  });

  it("keeps a Closure or Deadline default for everything the feed imports", () => {
    expect(autoEntryType("Registration Due", "CLOSURE")).toBe("CLOSURE");
    expect(autoEntryType("Camporee", "DEADLINE")).toBe("DEADLINE");
  });
});

describe("a refresh and the type staff chose (#910)", () => {
  const row = (patch: Partial<Parameters<typeof refreshedEntryType>[0]> = {}) => ({
    title: "Camporee", entryType: "STANDARD" as const, locallyEditedFields: [] as string[], ...patch,
  });

  it("moves an untouched item to Deadline when its title now says it is due, and back", () => {
    expect(refreshedEntryType(row(), "Camporee Registration Due", "STANDARD")).toBe("DEADLINE");
    expect(refreshedEntryType(row({ entryType: "DEADLINE" }), "Camporee", "STANDARD")).toBe("STANDARD");
    expect(refreshedEntryType(row({ entryType: "DEADLINE" }), "Registration Due", "STANDARD")).toBeNull();
  });

  it("never changes a type staff set, either way", () => {
    expect(refreshedEntryType(row({ locallyEditedFields: ["entryType"] }), "Registration Due", "STANDARD")).toBeNull();
    expect(refreshedEntryType(row({ entryType: "DEADLINE", locallyEditedFields: ["entryType"] }), "Camporee", "STANDARD")).toBeNull();
  });

  it("leaves a Closure alone", () => {
    expect(refreshedEntryType(row({ entryType: "CLOSURE" }), "Office Due", "STANDARD")).toBeNull();
  });
});

describe("reminder points in the conference time zone (#910)", () => {
  it("is 14 days and 2 days before the due date, as calendar dates", () => {
    expect(reminderDate("2026-12-05", 14)).toBe("2026-11-21");
    expect(reminderDate("2026-12-05", 2)).toBe("2026-12-03");
  });

  it("is reached on its own date, and stays the current point until the next", () => {
    const due = "2026-12-05";
    expect(reminderPointFor(due, "2026-11-20")).toBeNull();
    expect(reminderPointFor(due, "2026-11-21")).toBe(14);
    expect(reminderPointFor(due, "2026-12-02")).toBe(14);
    expect(reminderPointFor(due, "2026-12-03")).toBe(2);
    expect(reminderPointFor(due, "2026-12-05")).toBe(2);
    expect(reminderPointFor(due, "2026-12-06")).toBeNull();
  });

  it("gives a deadline added late one reminder, never both", () => {
    // Added 10 days out: the 14-day point has passed, the 2-day point has not come.
    expect(reminderPointFor("2026-12-05", "2026-11-25")).toBe(14);
    // Added the day before it is due.
    expect(reminderPointFor("2026-12-05", "2026-12-04")).toBe(2);
  });

  it("uses the Chicago date, so the point arrives at Chicago midnight (daylight time)", () => {
    // 2026-12-05 is due: the 14-day point is November 21. CST is UTC-6.
    expect(reminderPointFor("2026-12-05", calendarDateIn(new Date("2026-11-21T05:59:00Z")))).toBeNull();
    expect(reminderPointFor("2026-12-05", calendarDateIn(new Date("2026-11-21T06:00:00Z")))).toBe(14);
    // October 3 is still daylight time (UTC-5): due October 17, the 14-day point is October 3 at 05:00Z.
    expect(reminderPointFor("2026-10-17", calendarDateIn(new Date("2026-10-03T04:59:00Z")))).toBeNull();
    expect(reminderPointFor("2026-10-17", calendarDateIn(new Date("2026-10-03T05:00:00Z")))).toBe(14);
  });

  it("holds across the November daylight-saving change (fall back, Nov 1 2026)", () => {
    // Due Nov 15: the 14-day point is Nov 1, the day the clocks go back at 2 AM (07:00Z).
    const due = "2026-11-15";
    expect(reminderPointFor(due, calendarDateIn(new Date("2026-11-01T04:59:00Z")))).toBeNull(); // still Oct 31, 11:59 PM CDT
    expect(reminderPointFor(due, calendarDateIn(new Date("2026-11-01T05:00:00Z")))).toBe(14); // midnight CDT
    expect(reminderPointFor(due, calendarDateIn(new Date("2026-11-01T12:00:00Z")))).toBe(14); // after the change, 6 AM CST
    // The 2-day point (Nov 13) arrives at midnight CST, which is 06:00Z now.
    expect(reminderPointFor(due, calendarDateIn(new Date("2026-11-13T05:59:00Z")))).toBe(14);
    expect(reminderPointFor(due, calendarDateIn(new Date("2026-11-13T06:00:00Z")))).toBe(2);
    // A due date after the change counts whole days, not 24-hour blocks: Nov 2 is 14 days before Nov 16.
    expect(reminderPointFor("2026-11-16", calendarDateIn(new Date("2026-11-02T06:00:00Z")))).toBe(14);
    expect(reminderPointFor("2026-11-16", calendarDateIn(new Date("2026-11-02T05:59:00Z")))).toBeNull();
  });

  it("holds across the March daylight-saving change (spring forward, Mar 14 2027)", () => {
    // Due Mar 16 2027: the 2-day point is Mar 14, the day the clocks go forward at 2 AM (08:00Z).
    const due = "2027-03-16";
    expect(reminderPointFor(due, calendarDateIn(new Date("2027-03-14T05:59:00Z")))).toBe(14); // Mar 13, 11:59 PM CST
    expect(reminderPointFor(due, calendarDateIn(new Date("2027-03-14T06:00:00Z")))).toBe(2); // midnight CST, Mar 14
    expect(reminderPointFor(due, calendarDateIn(new Date("2027-03-14T12:00:00Z")))).toBe(2); // after the change
    // The 14-day point from Mar 28 is Mar 14 too.
    expect(reminderPointFor("2027-03-28", calendarDateIn(new Date("2027-03-14T05:59:00Z")))).toBeNull();
    expect(reminderPointFor("2027-03-28", calendarDateIn(new Date("2027-03-14T06:00:00Z")))).toBe(14);
  });

  it("counts whole calendar days across a daylight-saving change", () => {
    expect(daysUntil("2026-11-15", "2026-11-01")).toBe(14);
    expect(daysUntil("2027-03-28", "2027-03-14")).toBe(14);
    expect(daysUntil("2026-12-05", "2026-12-08")).toBe(-3);
  });

  it("ignores a malformed date", () => {
    expect(reminderPointFor("soon", "2026-11-01")).toBeNull();
  });
});

describe("the upcoming deadlines list (#910)", () => {
  it("looks 90 days ahead and 7 days back", () => {
    expect(deadlineWindow("2026-10-13")).toEqual({ from: "2026-10-06", to: "2027-01-11" });
  });

  it("words how soon each is due, and marks passed ones overdue", () => {
    expect(dueLabel("2026-10-13", "2026-10-13")).toBe("Due today");
    expect(dueLabel("2026-10-14", "2026-10-13")).toBe("Due tomorrow");
    expect(dueLabel("2026-10-22", "2026-10-13")).toBe("Due in 9 days");
    expect(dueLabel("2026-10-12", "2026-10-13")).toBe("1 day overdue");
    expect(dueLabel("2026-10-10", "2026-10-13")).toBe("3 days overdue");
    const item = toDeadlineListItem({ key: "a", title: "Reports Due", dueOn: "2026-10-10", linkUrl: "https://example.test/x", status: "SCHEDULED" }, "2026-10-13");
    expect(item).toMatchObject({ overdue: true, label: "3 days overdue", href: "https://example.test/x", postponed: false });
  });

  it("orders by date, then title", () => {
    const sorted = sortDeadlineItems([
      { dueOn: "2026-11-01", title: "B" }, { dueOn: "2026-10-10", title: "Z" }, { dueOn: "2026-11-01", title: "A" },
    ]);
    expect(sorted.map((item) => `${item.dueOn} ${item.title}`)).toEqual(["2026-10-10 Z", "2026-11-01 A", "2026-11-01 B"]);
  });
});

describe("the reminder email (#910)", () => {
  const base = { title: "Spring Camporee Registration Due", dueOn: "2026-12-05", linkUrl: null, portalUrl: "https://events.example.test/account/clubs", audience: "CLUB" as const, recipientName: "Alex Example" };

  it("says what is due, when, how soon, and links the club portal", () => {
    const email = buildDeadlineReminderEmail({ ...base, today: "2026-11-21" });
    expect(email.subject).toBe("Deadline reminder: Spring Camporee Registration Due (December 5, 2026)");
    expect(email.bodyText).toContain("Hello Alex Example,");
    expect(email.bodyText).toContain('"Spring Camporee Registration Due" is due on Saturday, December 5, 2026 (in 14 days).');
    expect(email.bodyText).toContain("https://events.example.test/account/clubs");
    expect(email.bodyText).toContain("IMSDA Events");
    expect(email.bodyText).not.toContain("More details");
  });

  it("counts down at the 2-day point and on the day itself", () => {
    expect(buildDeadlineReminderEmail({ ...base, today: "2026-12-03" }).bodyText).toContain("(in 2 days)");
    expect(buildDeadlineReminderEmail({ ...base, today: "2026-12-04" }).bodyText).toContain("(tomorrow)");
    expect(buildDeadlineReminderEmail({ ...base, today: "2026-12-05" }).bodyText).toContain("is due today, Saturday, December 5, 2026.");
  });

  it("includes the deadline's link when there is one", () => {
    expect(buildDeadlineReminderEmail({ ...base, today: "2026-12-03", linkUrl: "https://example.test/register" }).bodyText).toContain("More details: https://example.test/register");
  });

  it("speaks to an Area Coordinator about their clubs", () => {
    const email = buildDeadlineReminderEmail({ ...base, today: "2026-12-03", audience: "AREA", portalUrl: "https://events.example.test/account/area-clubs/overview" });
    expect(email.bodyText).toContain("clubs in your area");
    expect(email.bodyText).toContain("/account/area-clubs/overview");
  });

  it("keeps a title to one line, so it can never add a header or a paragraph", () => {
    expect(singleLine("Reports Due\r\nBcc: someone@example.test")).toBe("Reports Due Bcc: someone@example.test");
    const email = buildDeadlineReminderEmail({ ...base, today: "2026-12-03", title: "Reports Due\r\nBcc: someone@example.test", recipientName: "" });
    expect(email.subject.includes("\n")).toBe(false);
    expect(email.bodyText).toContain("Hello there,");
  });
});
