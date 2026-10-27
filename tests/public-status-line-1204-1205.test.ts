import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calendarItemStatusLine, type CalendarItem } from "@/modules/calendar/domain";
import { publicStatusLine } from "@/modules/events/public-registration-status";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-27T15:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("one plain-language status line (#1204, #1205)", () => {
  it("says open, opening soon and closed in the same words everywhere", () => {
    expect(publicStatusLine({ status: "OPEN" })).toBe("Registration open");
    expect(publicStatusLine({ status: "OPEN", isClubEvent: true })).toBe("Registration open");
    expect(publicStatusLine({ status: "OPENING_SOON", opensOn: "2026-10-01" })).toBe("Registration opening soon");
    expect(publicStatusLine({ status: "CLOSED" })).toBe("Registration closed");
    expect(publicStatusLine({ status: "DRAFT" })).toBe("Registration closed");
  });

  it("names the opening month, adding the year only when it is not this year", () => {
    expect(publicStatusLine({ status: "UPCOMING", opensOn: "2026-12-01" })).toBe("Registration opens in December");
    expect(publicStatusLine({ status: "UPCOMING", opensOn: "2027-02-15" })).toBe("Registration opens in February 2027");
    expect(publicStatusLine({ status: "UPCOMING", opensOn: "2027-02-15" }, new Date("2027-01-05T12:00:00Z"))).toBe("Registration opens in February");
  });

  it("says club registration for a club event, and soon when no date is set", () => {
    expect(publicStatusLine({ status: "UPCOMING", opensOn: "2026-12-01", isClubEvent: true })).toBe("Club registration opens in December");
    expect(publicStatusLine({ status: "UPCOMING", opensOn: null })).toBe("Registration opens soon");
    expect(publicStatusLine({ status: "UPCOMING", opensOn: "not-a-date", isClubEvent: true })).toBe("Club registration opens soon");
  });

  it("lists and the calendar take the line from the item's shared status", () => {
    const base = { key: "event-1", kind: "EVENT", title: "Synthetic", description: "", startsOn: "2027-03-05", endsOn: "2027-03-07", timeLabel: "", location: "", category: "", href: "/events/x", status: "SCHEDULED", registrationOpen: false } as CalendarItem;
    expect(calendarItemStatusLine({ ...base, registrationStatus: "UPCOMING", registrationOpensOn: "2026-12-01", clubEvent: true })).toBe("Club registration opens in December");
    expect(calendarItemStatusLine({ ...base, registrationOpen: true, registrationStatus: "OPEN" })).toBe("Registration open");
    expect(calendarItemStatusLine({ ...base, registrationStatus: "CLOSED" })).toBe("Registration closed");
    expect(calendarItemStatusLine({ ...base, registrationOpen: true })).toBe("Registration open");
    expect(calendarItemStatusLine({ ...base, kind: "ENTRY", registrationStatus: "OPEN" })).toBeNull();
    expect(calendarItemStatusLine({ ...base, status: "CANCELLED", registrationStatus: "OPEN" })).toBeNull();
  });
});
