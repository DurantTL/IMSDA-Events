import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calendarItemStatusLine, type CalendarItem } from "@/modules/calendar/domain";
import { publicStatusLine } from "@/modules/events/public-registration-status";

// 2026-10-27 15:00 UTC is 10:00 AM in Chicago (CDT).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-27T15:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const line = (opensOn: string, extra: { isClubEvent?: boolean; timeZone?: string } = {}, now = new Date()) =>
  publicStatusLine({ status: "UPCOMING", opensOn, ...extra }, now);

describe("registration countdown (#1209)", () => {
  it("counts whole days up to 30, and names the month beyond that", () => {
    expect(line("2026-11-27")).toBe("Registration opens in November");
    expect(line("2026-11-26")).toBe("Registration opens in 30 days");
    expect(line("2026-10-29")).toBe("Registration opens in 2 days");
  });

  it("says tomorrow for one day, and keeps the club noun", () => {
    expect(line("2026-10-28")).toBe("Registration opens tomorrow");
    expect(line("2026-10-28", { isClubEvent: true })).toBe("Club registration opens tomorrow");
    expect(line("2026-11-10", { isClubEvent: true })).toBe("Club registration opens in 14 days");
  });

  it("uses today in the event's time zone, not UTC", () => {
    // 11:30 PM Chicago on Oct 27 is already Oct 28 in UTC; Chicago's today is still the 27th.
    const lateChicago = new Date("2026-10-28T04:30:00Z");
    expect(line("2026-10-29", {}, lateChicago)).toBe("Registration opens in 2 days");
    expect(line("2026-10-28", {}, lateChicago)).toBe("Registration opens tomorrow");
  });

  it("works in other zones and defaults to Chicago", () => {
    const now = new Date("2026-10-28T05:30:00Z"); // Oct 27 11:30 PM Denver (MDT), Oct 28 12:30 AM Chicago
    expect(line("2026-10-29", { timeZone: "America/Denver" }, now)).toBe("Registration opens in 2 days");
    expect(line("2026-10-29", {}, now)).toBe("Registration opens tomorrow");
    const pacific = new Date("2026-10-28T06:30:00Z"); // Oct 27 11:30 PM Pacific
    expect(line("2026-10-28", { timeZone: "America/Los_Angeles" }, pacific)).toBe("Registration opens tomorrow");
  });

  it("reads the same on the calendar and homepage rows, using the event's time zone", () => {
    const item = {
      registrationStatus: "UPCOMING",
      registrationOpensOn: "2026-10-29",
      clubEvent: false,
      registrationOpen: false,
      kind: "EVENT",
    } as unknown as CalendarItem;
    const now = new Date("2026-10-28T05:30:00Z");
    expect(calendarItemStatusLine({ ...item, registrationTimeZone: "America/Denver" }, now)).toBe("Registration opens in 2 days");
    expect(calendarItemStatusLine(item, now)).toBe("Registration opens tomorrow");
  });
});
