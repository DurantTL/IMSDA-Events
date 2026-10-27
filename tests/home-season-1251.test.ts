import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarItem } from "@/modules/calendar/domain";
import {
  closingSoonFor,
  helpContactLinks,
  laneFor,
  ministryTiles,
  nextClosingSoon,
  nextItemForCategories,
  nextMonthsList,
  seasonMonthMarks,
  seasonRibbon,
  seasonWindow,
  shortDateRange,
} from "@/modules/calendar/home-season";
import { daysUntilRegistrationCloses, registrationClosesLine } from "@/modules/events/public-registration-status";
import { fallbackHomepageMinistries, ministryLinkHref, type HomepageMinistry } from "@/modules/system-admin/homepage-ministries-domain";

const NOW = new Date("2026-10-27T15:00:00Z"); // 10:00 in Chicago
const TODAY = "2026-10-27";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

function item(key: string, overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    key,
    kind: "EVENT",
    title: `Synthetic ${key}`,
    description: "",
    startsOn: "2026-11-07",
    endsOn: "2026-11-07",
    timeLabel: "",
    location: "",
    category: "Youth",
    href: `/events/${key}`,
    status: "SCHEDULED",
    registrationOpen: true,
    registrationStatus: "OPEN",
    registrationTimeZone: "America/Chicago",
    ...overrides,
  };
}

describe("registration closing countdown (#1251, #1209)", () => {
  it("counts whole days to the closing date in the event's own zone, inclusive of the closing day", () => {
    expect(daysUntilRegistrationCloses("2026-10-27", "America/Chicago", NOW)).toBe(0);
    expect(daysUntilRegistrationCloses("2026-10-28", "America/Chicago", NOW)).toBe(1);
    expect(daysUntilRegistrationCloses("2026-11-01", "America/Chicago", NOW)).toBe(5);
    expect(daysUntilRegistrationCloses("2026-10-26", "America/Chicago", NOW)).toBeNull();
    expect(daysUntilRegistrationCloses(null, "America/Chicago", NOW)).toBeNull();
  });

  it("includes day 14 and excludes day 15", () => {
    expect(daysUntilRegistrationCloses("2026-11-10", "America/Chicago", NOW)).toBe(14);
    expect(daysUntilRegistrationCloses("2026-11-11", "America/Chicago", NOW)).toBeNull();
  });

  it("uses the event's own today: 03:00 UTC on Oct 28 is still Oct 27 in Chicago but already Oct 28 in Auckland", () => {
    vi.setSystemTime(new Date("2026-10-28T03:00:00Z"));
    expect(daysUntilRegistrationCloses("2026-10-28", "America/Chicago")).toBe(1);
    expect(daysUntilRegistrationCloses("2026-10-28", "Pacific/Auckland")).toBe(0);
    // Once it is Oct 29 in Auckland, an Oct 28 closing date has passed there.
    expect(daysUntilRegistrationCloses("2026-10-28", "Pacific/Auckland", new Date("2026-10-28T20:00:00Z"))).toBeNull();
  });

  it("words today, tomorrow and later days", () => {
    expect(registrationClosesLine(0, "x")).toBe("Registration closes today");
    expect(registrationClosesLine(1, "x")).toBe("Registration closes tomorrow");
    expect(registrationClosesLine(5, "December 5, 2026")).toBe("Registration closes in 5 days, on December 5, 2026");
  });
});

describe("closing soon (#1251)", () => {
  it("flags an open event closing within 14 days, with the written date", () => {
    const flag = closingSoonFor(item("a", { registrationClosesOn: "2026-11-01" }), NOW);
    expect(flag).toMatchObject({ days: 5, line: "Registration closes in 5 days, on November 1, 2026" });
  });

  it("flags a waitlist, but not a full, upcoming, closed, cancelled, closure or entry item", () => {
    const base = { registrationClosesOn: "2026-11-01" };
    expect(closingSoonFor(item("w", { ...base, registrationStatus: "WAITLIST" }), NOW)).not.toBeNull();
    for (const registrationStatus of ["FULL", "UPCOMING", "CLOSED", "OPENING_SOON", "DRAFT"] as const) {
      expect(closingSoonFor(item("x", { ...base, registrationStatus, registrationOpen: false }), NOW)).toBeNull();
    }
    expect(closingSoonFor(item("c", { ...base, status: "CANCELLED" }), NOW)).toBeNull();
    expect(closingSoonFor(item("z", { ...base, isClosure: true }), NOW)).toBeNull();
    expect(closingSoonFor(item("e", { ...base, kind: "ENTRY" }), NOW)).toBeNull();
    expect(closingSoonFor(item("n"), NOW)).toBeNull();
  });

  it("picks the soonest closing, ties to the earlier start, and nothing when none is within 14 days", () => {
    const items = [
      item("late", { registrationClosesOn: "2026-11-09" }),
      item("soon", { registrationClosesOn: "2026-10-30", startsOn: "2026-12-01", endsOn: "2026-12-01" }),
      item("soon-first", { registrationClosesOn: "2026-10-30", startsOn: "2026-11-20", endsOn: "2026-11-20" }),
    ];
    expect(nextClosingSoon(items, NOW)?.item.key).toBe("soon-first");
    expect(nextClosingSoon([item("far", { registrationClosesOn: "2026-12-30" })], NOW)).toBeNull();
    expect(nextClosingSoon([], NOW)).toBeNull();
  });

  it("counts in the event's own zone", () => {
    vi.setSystemTime(new Date("2026-10-27T20:00:00Z")); // Oct 28 09:00 in Auckland, Oct 27 15:00 in Chicago
    expect(closingSoonFor(item("auckland", { registrationClosesOn: "2026-10-28", registrationTimeZone: "Pacific/Auckland" }))?.days).toBe(0);
    expect(closingSoonFor(item("chicago", { registrationClosesOn: "2026-10-28" }))?.days).toBe(1);
  });
});

describe("lanes (#1251)", () => {
  it("puts closures, club events and Pathfinder/Adventurer items in their own lanes, the rest with ministries and camps", () => {
    expect(laneFor(item("a", { isClosure: true, category: "Pathfinders" }))).toBe("closed");
    expect(laneFor(item("b", { clubEvent: true, category: "Youth" }))).toBe("clubs");
    expect(laneFor(item("c", { category: " pathfinders " }))).toBe("clubs");
    expect(laneFor(item("d", { category: "ADVENTURERS" }))).toBe("clubs");
    expect(laneFor(item("e", { category: "Camp Meeting" }))).toBe("ministries");
    expect(laneFor(item("f", { category: "" }))).toBe("ministries");
  });
});

describe("the six-month ribbon (#1251)", () => {
  it("runs from today to the day before the same day six months later, clamping the last day of a short month", () => {
    expect(seasonWindow("2026-10-27")).toEqual({ start: "2026-10-27", end: "2027-04-26", totalDays: 182 });
    expect(seasonWindow("2026-08-31").end).toBe("2027-02-27");
    expect(seasonWindow("2026-10-01").end).toBe("2027-03-31");
  });

  it("labels each month start once and drops a first label that would sit on the next one", () => {
    expect(seasonMonthMarks(seasonWindow("2026-10-27")).map((mark) => mark.label)).toEqual(["November", "December", "January 2027", "February 2027", "March 2027", "April 2027"]);
    const full = seasonMonthMarks(seasonWindow("2026-10-01"));
    expect(full[0]).toEqual({ label: "October", leftPct: 0 });
    expect(full).toHaveLength(6);
  });

  it("places a one-day item as a dot and a multi-day item as a bar by date", () => {
    const window = seasonWindow(TODAY);
    const { lanes } = seasonRibbon([item("dot", { startsOn: "2026-11-07", endsOn: "2026-11-07" }), item("bar", { startsOn: "2026-11-07", endsOn: "2026-11-09", title: "Bar" })], window);
    const entries = lanes.find((lane) => lane.lane === "ministries")!.entries;
    const dot = entries.find((entry) => entry.item.key === "dot")!;
    const bar = entries.find((entry) => entry.item.key === "bar")!;
    expect(dot.mark).toBe("dot");
    expect(bar.mark).toBe("bar");
    expect(dot.anchor).toBe("left");
    expect(dot.edgePct).toBeCloseTo((11 / 182) * 100, 1);
    expect(bar.dateLabel).toBe("Nov 7–9");
    expect(bar.accessibleLabel).toContain("Bar, November 7, 2026 to November 9, 2026");
  });

  it("stacks entries that would overlap into rows and keeps far-apart entries on one row", () => {
    const window = seasonWindow(TODAY);
    const { lanes } = seasonRibbon([
      item("a", { startsOn: "2026-11-07", endsOn: "2026-11-07" }),
      item("b", { startsOn: "2026-11-08", endsOn: "2026-11-08" }),
      item("c", { startsOn: "2027-03-01", endsOn: "2027-03-01" }),
    ], window);
    const rows = Object.fromEntries(lanes.find((lane) => lane.lane === "ministries")!.entries.map((entry) => [entry.item.key, entry.row]));
    expect(rows).toEqual({ a: 0, b: 1, c: 0 });
    expect(lanes.find((lane) => lane.lane === "ministries")!.rows).toBe(2);
    expect(lanes.find((lane) => lane.lane === "clubs")).toMatchObject({ rows: 1, entries: [] });
  });

  it("clamps an item already under way to today, hangs a late item from the right edge, and leaves out cancelled and out-of-window items", () => {
    const window = seasonWindow(TODAY);
    const { lanes } = seasonRibbon([
      item("under-way", { startsOn: "2026-10-20", endsOn: "2026-11-02" }),
      item("late", { startsOn: "2027-04-20", endsOn: "2027-04-20", title: "A late spring gathering" }),
      item("gone", { status: "CANCELLED" }),
      item("past", { startsOn: "2026-10-01", endsOn: "2026-10-02" }),
      item("beyond", { startsOn: "2027-06-01", endsOn: "2027-06-01" }),
    ], window);
    const entries = lanes.flatMap((lane) => lane.entries);
    expect(entries.map((entry) => entry.item.key).sort()).toEqual(["late", "under-way"]);
    expect(entries.find((entry) => entry.item.key === "under-way")!.edgePct).toBe(0);
    const late = entries.find((entry) => entry.item.key === "late")!;
    expect(late.anchor).toBe("right");
    expect(late.edgePct).toBeLessThan(5);
  });

  it("shows a repeating series once", () => {
    const window = seasonWindow(TODAY);
    const { lanes } = seasonRibbon([
      item("r1", { seriesId: "s", kind: "ENTRY", startsOn: "2026-11-02", endsOn: "2026-11-02" }),
      item("r2", { seriesId: "s", kind: "ENTRY", startsOn: "2026-11-09", endsOn: "2026-11-09" }),
    ], window);
    expect(lanes.flatMap((lane) => lane.entries)).toHaveLength(1);
  });
});

describe("the three-month list (#1251)", () => {
  it("groups by month starting with this one, an item under way sits under this month, and empty months stay", () => {
    const months = nextMonthsList([
      item("under-way", { startsOn: "2026-10-20", endsOn: "2026-10-29" }),
      item("nov", { startsOn: "2026-11-30", endsOn: "2026-12-01" }),
      item("jan", { startsOn: "2027-01-02", endsOn: "2027-01-02" }),
      item("gone", { startsOn: "2026-11-05", endsOn: "2026-11-05", status: "CANCELLED" }),
    ], TODAY);
    expect(months.map((month) => month.label)).toEqual(["October 2026", "November 2026", "December 2026"]);
    expect(months[0].entries.map((entry) => entry.item.key)).toEqual(["under-way"]);
    expect(months[1].entries.map((entry) => `${entry.item.key}:${entry.dateLabel}`)).toEqual(["nov:Nov 30 – Dec 1"]);
    expect(months[2].entries).toEqual([]);
  });

  it("flags closures", () => {
    const months = nextMonthsList([item("closed", { isClosure: true, kind: "ENTRY", href: null, startsOn: "2026-11-26", endsOn: "2026-11-27" })], TODAY);
    expect(months[1].entries[0]).toMatchObject({ isClosure: true, dateLabel: "Nov 26–27" });
  });

  it("writes dates across a month and short ranges", () => {
    expect(shortDateRange("2026-11-07", "2026-11-07")).toBe("Nov 7");
    expect(shortDateRange("2026-12-30", "2027-01-02")).toBe("Dec 30 – Jan 2");
  });
});

describe("ministry tiles (#1251)", () => {
  const tile = (overrides: Partial<HomepageMinistry> = {}): HomepageMinistry => ({ position: 1, name: "Youth", description: null, linkHref: null, categories: ["Youth"], icon: "Sparkles", ...overrides });

  it("takes the first upcoming attendable item in any of the tile's categories, ignoring case and spacing", () => {
    const items = [
      item("past", { startsOn: "2026-10-01", endsOn: "2026-10-02" }),
      item("cancelled", { startsOn: "2026-10-30", endsOn: "2026-10-30", status: "CANCELLED" }),
      item("closure", { startsOn: "2026-10-31", endsOn: "2026-10-31", isClosure: true }),
      item("other", { startsOn: "2026-11-01", endsOn: "2026-11-01", category: "Men's Ministries" }),
      item("match", { startsOn: "2026-11-03", endsOn: "2026-11-03", category: "  youth " }),
      item("later", { startsOn: "2026-11-09", endsOn: "2026-11-09", category: "Camp Meeting" }),
    ];
    expect(nextItemForCategories(items, ["YOUTH", "camp meeting"], TODAY)?.key).toBe("match");
    expect(nextItemForCategories(items, ["Camp Meeting"], TODAY)?.key).toBe("later");
  });

  it("counts an item still under way as upcoming", () => {
    expect(nextItemForCategories([item("now", { startsOn: "2026-10-26", endsOn: "2026-10-28" })], ["Youth"], TODAY)?.key).toBe("now");
  });

  it("shows nothing extra when there is no match, no categories, or no items", () => {
    expect(nextItemForCategories([], ["Youth"], TODAY)).toBeNull();
    expect(nextItemForCategories([item("a")], [], TODAY)).toBeNull();
    expect(nextItemForCategories([item("a")], ["  "], TODAY)).toBeNull();
    expect(ministryTiles([tile({ categories: ["Adventurers"] })], [item("a")], TODAY, NOW)[0]).toMatchObject({ next: null, closing: null });
  });

  it("gives the next title and date, plus a closing flag only when that event closes within 14 days", () => {
    const [soon] = ministryTiles([tile()], [item("a", { registrationClosesOn: "2026-10-28" })], TODAY, NOW);
    expect(soon.next).toEqual({ title: "Synthetic a", dateLabel: "Nov 7" });
    expect(soon.closing?.line).toBe("Registration closes tomorrow");
    const [far] = ministryTiles([tile()], [item("a", { registrationClosesOn: "2026-12-20" })], TODAY, NOW);
    expect(far.closing).toBeNull();
  });

  it("orders by position and falls back to the six names with no upcoming line", () => {
    const tiles = ministryTiles(fallbackHomepageMinistries, [item("a")], TODAY, NOW);
    expect(tiles.map((entry) => entry.name)).toEqual(["Pathfinders", "Adventurers", "Women's Ministries", "Men's Ministries", "Camp Meeting", "Youth"]);
    expect(tiles.every((entry) => entry.next === null && entry.href === "/calendar?view=list")).toBe(true);
  });

  it("links to the tile's own link, else the calendar filtered to the first category, else the calendar", () => {
    expect(ministryLinkHref({ linkHref: "/clubs", categories: ["Youth"] })).toBe("/clubs");
    expect(ministryLinkHref({ linkHref: "https://example.test/x", categories: [] })).toBe("https://example.test/x");
    expect(ministryLinkHref({ linkHref: null, categories: ["Women's Ministries", "Youth"] })).toBe("/calendar?view=list&category=Women's%20Ministries");
    expect(ministryLinkHref({ linkHref: "", categories: [] })).toBe("/calendar?view=list");
    // A stored link that fails the rule is never used.
    expect(ministryLinkHref({ linkHref: "//evil.example", categories: ["Youth"] })).toBe("/calendar?view=list&category=Youth");
    expect(ministryLinkHref({ linkHref: "javascript:alert(1)", categories: [] })).toBe("/calendar?view=list");
  });
});

describe("help contact (#1251)", () => {
  it("has links only for the parts that are set", () => {
    expect(helpContactLinks({ phone: null, email: null })).toBeNull();
    expect(helpContactLinks({ phone: "  ", email: "" })).toBeNull();
    expect(helpContactLinks({ phone: "(515) 555-0100", email: null })).toEqual({ phone: { text: "(515) 555-0100", href: "tel:5155550100" }, email: null });
    expect(helpContactLinks({ phone: null, email: "help@example.test" })?.email?.href).toBe("mailto:help@example.test");
  });
});
