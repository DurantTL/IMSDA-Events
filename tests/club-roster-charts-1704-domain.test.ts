import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attendanceByMonth,
  birthdaysInMonth,
  canSeeRosterBirthdays,
  canSeeRosterCharts,
  conferenceMonthOf,
  conferenceToday,
  countByAgeBand,
  countByClassLevel,
  countByMemberType,
  countBySchoolGrade,
  parseBirthdayMonth,
  summarizeAttendance,
  summarizeCounts,
} from "@/modules/club-roster-charts/domain";
import { clubYearDateBounds } from "@/modules/club-meeting-notes/domain";
import { clubCapabilities } from "@/modules/organizations/director-grants-domain";

/** Roster charts and birthdays (#1704), pure. Synthetic data only. */

const members = [
  { attendeeType: "YOUTH", classLevel: "FRIEND", schoolGrade: "GRADE_4" },
  { attendeeType: "YOUTH", classLevel: "FRIEND", schoolGrade: "GRADE_4" },
  { attendeeType: "YOUTH", classLevel: "RANGER", schoolGrade: "GRADE_8" },
  { attendeeType: "YOUTH", classLevel: null, schoolGrade: null },
  { attendeeType: "STAFF", classLevel: "MASTER_GUIDE", schoolGrade: null },
  { attendeeType: "ADULT", classLevel: null, schoolGrade: null },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T12:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("who sees what", () => {
  it("shows charts to the roster roles and birthdays only to those who see birth dates", () => {
    expect(canSeeRosterCharts(clubCapabilities("DIRECTOR"))).toBe(true);
    expect(canSeeRosterCharts(clubCapabilities("DEPUTY"))).toBe(true);
    expect(canSeeRosterCharts(clubCapabilities("REGISTRAR"))).toBe(true);
    expect(canSeeRosterCharts(clubCapabilities("REPORTER"))).toBe(false);
    expect(canSeeRosterBirthdays(clubCapabilities("DIRECTOR"))).toBe(true);
    expect(canSeeRosterBirthdays(clubCapabilities("DEPUTY"))).toBe(true);
    expect(canSeeRosterBirthdays(clubCapabilities("REGISTRAR"))).toBe(false);
    expect(canSeeRosterBirthdays(clubCapabilities("REPORTER"))).toBe(false);
  });
});

describe("counts", () => {
  it("counts by class in class order with no-class last, leaving out empty classes", () => {
    expect(countByClassLevel(members)).toEqual([
      { key: "FRIEND", label: "Friend", value: 2 },
      { key: "RANGER", label: "Ranger", value: 1 },
      { key: "MASTER_GUIDE", label: "Master Guide", value: 1 },
      { key: "NOT_SET", label: "No class set", value: 2 },
    ]);
  });

  it("counts youth by school grade and a youth with no grade as not set; other types are not counted", () => {
    expect(countBySchoolGrade(members)).toEqual([
      { key: "GRADE_4", label: "4th grade", value: 2 },
      { key: "GRADE_8", label: "8th grade", value: 1 },
      { key: "NOT_SET", label: "Grade not set", value: 1 },
    ]);
  });

  it("counts by member type", () => {
    expect(countByMemberType(members)).toEqual([
      { key: "YOUTH", label: "Youth", value: 4 },
      { key: "STAFF", label: "Staff", value: 1 },
      { key: "ADULT", label: "Adult", value: 1 },
    ]);
  });

  it("returns no rows for an empty roster and says so in the summary", () => {
    expect(countByClassLevel([])).toEqual([]);
    expect(countBySchoolGrade([])).toEqual([]);
    expect(countByMemberType([])).toEqual([]);
    expect(summarizeCounts("by class", [])).toBe("No by class to show.");
  });

  it("writes a text summary with the numbers", () => {
    expect(summarizeCounts("by member type", countByMemberType(members))).toBe("6 people by member type: Youth 4, Staff 1, Adult 1.");
  });
});

describe("age groups (pinned clock)", () => {
  it("groups people by age today, counting a missing birth date apart", () => {
    const today = conferenceToday(new Date());
    expect(today).toBe("2026-11-12");
    const rows = countByAgeBand(["2019-01-01", "2015-11-12", "2015-11-13", "2012-05-05", "2009-11-12", "1985-03-03", null], today);
    expect(rows).toEqual([
      { key: "UNDER_10", label: "Under 10", value: 1 },
      { key: "10_12", label: "10 to 12", value: 2 },
      { key: "13_15", label: "13 to 15", value: 1 },
      { key: "16_17", label: "16 and 17", value: 1 },
      { key: "18_PLUS", label: "18 and over", value: 1 },
      { key: "NOT_SET", label: "No birth date on file", value: 1 },
    ]);
  });

  it("returns only counts: no row holds a date or an age", () => {
    const rows = countByAgeBand(["2014-06-15"], "2026-11-12");
    expect(JSON.stringify(rows)).not.toMatch(/\d{4}/);
  });

  it("returns nothing for no people", () => {
    expect(countByAgeBand([], "2026-11-12")).toEqual([]);
  });
});

describe("birthdays", () => {
  const people = [
    { name: "Zoe Sample", birthDate: "2014-11-20" },
    { name: "Ann Example", birthDate: "2012-11-03" },
    { name: "Bo Test", birthDate: "2013-11-03" },
    { name: "Cy Sample", birthDate: "2010-02-29" },
    { name: "Di Sample", birthDate: "1985-12-01" },
    { name: "Bad Date", birthDate: "not-a-date" },
  ];

  it("lists only the month, by day then name, as month and day", () => {
    expect(birthdaysInMonth(people, 11)).toEqual([
      { name: "Ann Example", monthDay: "November 3", day: 3 },
      { name: "Bo Test", monthDay: "November 3", day: 3 },
      { name: "Zoe Sample", monthDay: "November 20", day: 20 },
    ]);
  });

  it("never carries a year or an age in what it returns", () => {
    for (let month = 1; month <= 12; month += 1) {
      expect(JSON.stringify(birthdaysInMonth(people, month))).not.toMatch(/\d{4}/);
    }
    expect(Object.keys(birthdaysInMonth(people, 11)[0]!).sort()).toEqual(["day", "monthDay", "name"]);
  });

  it("includes a February 29 birthday in February and returns an empty list for a quiet month", () => {
    expect(birthdaysInMonth(people, 2)).toEqual([{ name: "Cy Sample", monthDay: "February 29", day: 29 }]);
    expect(birthdaysInMonth(people, 7)).toEqual([]);
    expect(birthdaysInMonth([], 11)).toEqual([]);
  });

  it("reads a month from the address, falling back for anything else", () => {
    expect(parseBirthdayMonth("3", 11)).toBe(3);
    expect(parseBirthdayMonth("12", 11)).toBe(12);
    expect(parseBirthdayMonth("13", 11)).toBe(11);
    expect(parseBirthdayMonth("0", 11)).toBe(11);
    expect(parseBirthdayMonth("abc", 11)).toBe(11);
    expect(parseBirthdayMonth(undefined, 11)).toBe(11);
    expect(parseBirthdayMonth(["4", "5"], 11)).toBe(4);
  });
});

describe("conference time zone", () => {
  it("uses the Central date and month at 7 pm on the last day of a month, not UTC", () => {
    const evening = new Date("2026-12-01T01:00:00.000Z"); // 7 pm Central on November 30
    expect(conferenceToday(evening)).toBe("2026-11-30");
    expect(conferenceMonthOf(evening)).toBe(11);
    expect(evening.getUTCMonth() + 1).toBe(12);
    // A person turning 12 on December 1 is still 11 that evening.
    expect(countByAgeBand(["2014-12-01"], conferenceToday(evening))[0]!.key).toBe("10_12");
    expect(countByAgeBand(["2014-11-30"], conferenceToday(evening))[0]!.key).toBe("10_12");
    expect(countByAgeBand(["2016-12-01"], conferenceToday(evening))[0]!.key).toBe("UNDER_10");
  });
});

describe("attendance by month", () => {
  it("groups meetings by month, oldest first, with the average present", () => {
    const rows = attendanceByMonth([
      { meetingDate: "2026-10-10", present: 8 },
      { meetingDate: "2026-09-12", present: 10 },
      { meetingDate: "2026-09-26", present: 5 },
      { meetingDate: "garbage", present: 99 },
    ]);
    expect(rows).toEqual([
      { month: "2026-09", label: "Sep 2026", meetings: 2, present: 15, averagePresent: 8 },
      { month: "2026-10", label: "Oct 2026", meetings: 1, present: 8, averagePresent: 8 },
    ]);
    expect(summarizeAttendance(rows)).toContain("Sep 2026, 2 meetings, average 8 present");
  });

  it("has an empty state", () => {
    expect(attendanceByMonth([])).toEqual([]);
    expect(summarizeAttendance([])).toMatch(/No meetings/);
  });

  it("covers a club year from September to August", () => {
    expect(clubYearDateBounds("2026-27")).toEqual({ from: "2026-09-01", to: "2027-08-31" });
  });
});
