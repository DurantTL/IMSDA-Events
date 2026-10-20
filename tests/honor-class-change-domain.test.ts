import { describe, expect, it } from "vitest";
import {
  CLASS_SUMMARY_GRACE_MS,
  buildClassChangeNotice,
  buildClassChangeSummary,
  classChangeIdempotencyKey,
  classSummaryIdempotencyKey,
  classSummaryWindow,
  describeYouth,
  isClassChangeEmailChoice,
  netClassChanges,
  type LoggedClassChange,
} from "@/modules/honors/class-change-domain";

let counter = 0;
function change(kind: "JOINED" | "LEFT", at: string, overrides: Partial<LoggedClassChange> = {}): LoggedClassChange {
  counter += 1;
  return {
    id: `change-${String(counter).padStart(3, "0")}`,
    offeringId: "class-knots",
    registrationAttendeeId: "attendee-a",
    kind,
    youthName: "Pat Example",
    clubName: "Synthetic Pathfinders",
    ageOnEventDate: 12,
    at: new Date(at),
    ...overrides,
  };
}

describe("the instructor's email choice (#1098)", () => {
  it("knows exactly three choices", () => {
    expect(["DAILY", "IMMEDIATE", "OFF"].every(isClassChangeEmailChoice)).toBe(true);
    expect(isClassChangeEmailChoice("WEEKLY")).toBe(false);
    expect(isClassChangeEmailChoice(undefined)).toBe(false);
  });
});

describe("the daily summary's schedule (#1098)", () => {
  it("is for 6:00 AM Central, with a short grace so a request that began just before can finish writing", () => {
    // October is daylight time: 6:00 AM CDT is 11:00 UTC.
    const before = classSummaryWindow(new Date("2026-10-21T10:59:00.000Z"));
    expect(before).toMatchObject({ dateKey: "2026-10-21", due: false });
    expect(before.sendAt.toISOString()).toBe("2026-10-21T11:00:00.000Z");
    expect(classSummaryWindow(new Date("2026-10-21T11:00:30.000Z")).due).toBe(false);
    expect(classSummaryWindow(new Date(before.sendAt.getTime() + CLASS_SUMMARY_GRACE_MS)).due).toBe(true);
  });

  it("follows standard time after the clocks change", () => {
    // 6:00 AM CST is 12:00 UTC.
    const window = classSummaryWindow(new Date("2026-11-10T13:00:00.000Z"));
    expect(window).toMatchObject({ dateKey: "2026-11-10", due: true });
    expect(window.sendAt.toISOString()).toBe("2026-11-10T12:00:00.000Z");
  });

  it("belongs to the Central date, not the UTC one", () => {
    // 04:00 UTC on the 21st is 11 PM Central on the 20th.
    expect(classSummaryWindow(new Date("2026-10-21T04:00:00.000Z")).dateKey).toBe("2026-10-20");
  });

  it("keys the message by instructor and date, so a second sweep reuses it", () => {
    expect(classSummaryIdempotencyKey("inst-1", "2026-10-21")).toBe("honor-class-change-summary:inst-1:2026-10-21");
    expect(classSummaryIdempotencyKey("inst-1", "2026-10-21")).toBe(classSummaryIdempotencyKey("inst-1", "2026-10-21"));
    expect(classSummaryIdempotencyKey("inst-1", "2026-10-22")).not.toBe(classSummaryIdempotencyKey("inst-1", "2026-10-21"));
    expect(classChangeIdempotencyKey("c-1", "inst-1")).toBe("honor-class-change:c-1:inst-1");
  });
});

describe("netting a day's changes (#1098)", () => {
  it("drops a join followed by a leave of the same youth in the same class", () => {
    expect(netClassChanges([change("JOINED", "2026-10-20T14:00:00Z"), change("LEFT", "2026-10-20T16:00:00Z")])).toEqual([]);
  });

  it("drops a leave followed by a rejoin too", () => {
    expect(netClassChanges([change("LEFT", "2026-10-20T14:00:00Z"), change("JOINED", "2026-10-20T16:00:00Z")])).toEqual([]);
  });

  it("keeps a join that stayed, and a leave that stayed", () => {
    const joined = change("JOINED", "2026-10-20T14:00:00Z");
    const left = change("LEFT", "2026-10-20T15:00:00Z", { registrationAttendeeId: "attendee-b", youthName: "Sam Sample" });
    expect(netClassChanges([left, joined]).map((entry) => [entry.youthName, entry.kind])).toEqual([["Pat Example", "JOINED"], ["Sam Sample", "LEFT"]]);
  });

  it("nets per youth and per class: another youth, or another class, never cancels it out", () => {
    const joinedKnots = change("JOINED", "2026-10-20T14:00:00Z");
    const leftBirds = change("LEFT", "2026-10-20T15:00:00Z", { offeringId: "class-birds" });
    const leftOtherYouth = change("LEFT", "2026-10-20T15:30:00Z", { registrationAttendeeId: "attendee-b" });
    expect(netClassChanges([joinedKnots, leftBirds, leftOtherYouth])).toHaveLength(3);
  });

  it("reports one change when the same kind repeats (the youth was already in or out when the window began)", () => {
    const first = change("LEFT", "2026-10-20T14:00:00Z");
    const second = change("LEFT", "2026-10-20T15:00:00Z");
    expect(netClassChanges([first, second])).toEqual([second]);
  });

  it("nets a join, leave and join into one join", () => {
    const rows = [change("JOINED", "2026-10-20T14:00:00Z"), change("LEFT", "2026-10-20T15:00:00Z"), change("JOINED", "2026-10-20T16:00:00Z")];
    expect(netClassChanges(rows).map((entry) => entry.kind)).toEqual(["JOINED"]);
  });
});

describe("the emails' wording (#1098)", () => {
  const klass = { offeringId: "class-knots", className: "Knot Tying", session: "Sabbath afternoon", enrolled: 11, capacity: 12 };

  it("names a youth by name, club and age only", () => {
    expect(describeYouth({ youthName: "Pat Example", clubName: "Synthetic Pathfinders", ageOnEventDate: 12 })).toBe("Pat Example (Synthetic Pathfinders, age 12)");
    expect(describeYouth({ youthName: "Pat Example", clubName: null, ageOnEventDate: null })).toBe("Pat Example");
  });

  it("summarizes every class with who joined, who left, the count against the limit and a link, and never a birth date", () => {
    const content = buildClassChangeSummary({
      recipientName: "Ira Instructor",
      eventName: "Synthetic Honors Weekend",
      baseUrl: "https://events.imsda-events.test",
      classes: [
        { ...klass, joined: [{ youthName: "Pat Example", clubName: "Synthetic Pathfinders", ageOnEventDate: 12 }], left: [{ youthName: "Sam Sample", clubName: "Synthetic Adventurers", ageOnEventDate: 10 }] },
        { offeringId: "class-birds", className: "Birds", session: "All sessions", enrolled: 13, capacity: 12, joined: [{ youthName: "Lee Fiction", clubName: null, ageOnEventDate: 14 }], left: [] },
      ],
    });
    expect(content.changes).toBe(3);
    expect(content.subject).toBe("Class list changes at Synthetic Honors Weekend");
    expect(content.bodyText).toContain("Hello Ira Instructor,");
    expect(content.bodyText).toContain("Knot Tying (Sabbath afternoon)");
    expect(content.bodyText).toContain("Joined: Pat Example (Synthetic Pathfinders, age 12)");
    expect(content.bodyText).toContain("Left: Sam Sample (Synthetic Adventurers, age 10)");
    expect(content.bodyText).toContain("Now 11 of 12 seats.");
    expect(content.bodyText).toContain("Now 13 of 12 seats (over the class limit).");
    expect(content.bodyText).toContain("https://events.imsda-events.test/account/instructor/class-knots");
    expect(content.bodyText).toContain("https://events.imsda-events.test/account/instructor/class-birds");
    expect(content.bodyText).not.toMatch(/birth|dob|born/i);
  });

  it("says one change in one email for a right-away notice", () => {
    const content = buildClassChangeNotice({
      recipientName: "Ira Instructor",
      eventName: "Synthetic Honors Weekend",
      baseUrl: "https://events.imsda-events.test",
      change: { ...klass, kind: "LEFT", youthName: "Sam Sample", clubName: "Synthetic Adventurers", ageOnEventDate: 10, joined: [], left: [] },
    });
    expect(content.subject).toBe("Sam Sample left Knot Tying");
    expect(content.bodyText).toContain("Sam Sample (Synthetic Adventurers, age 10) left your class Knot Tying (Sabbath afternoon) at Synthetic Honors Weekend.");
    expect(content.bodyText).toContain("Now 11 of 12 seats.");
    expect(content.bodyText).toContain("https://events.imsda-events.test/account/instructor/class-knots");
    expect(content.bodyText).not.toMatch(/birth|dob|born/i);
  });
});
