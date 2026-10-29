// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarItem } from "@/modules/calendar/domain";
import { formatDateRange } from "@/modules/calendar/domain";
import { buildCalendarWidgetEmbedCode, parseWidgetLimit, selectWidgetItems } from "@/modules/calendar/widget";

const listPublicCalendarItems = vi.fn();
vi.mock("@/modules/calendar/repository", async () => ({
  listPublicCalendarItems: (...args: unknown[]) => listPublicCalendarItems(...args),
  conferenceToday: () => "2026-11-10",
}));

function item(overrides: Partial<CalendarItem> & { key: string }): CalendarItem {
  return {
    kind: "ENTRY",
    title: overrides.key,
    description: "",
    startsOn: "2026-11-20",
    endsOn: "2026-11-20",
    timeLabel: "",
    location: "",
    category: "",
    href: null,
    status: "SCHEDULED",
    registrationOpen: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T18:00:00Z"));
  listPublicCalendarItems.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("widget selection (#107)", () => {
  const today = "2026-11-10";

  it("clamps and defaults the limit", () => {
    expect(parseWidgetLimit(undefined)).toBe(5);
    expect(parseWidgetLimit("abc")).toBe(5);
    expect(parseWidgetLimit("0")).toBe(1);
    expect(parseWidgetLimit("-4")).toBe(1);
    expect(parseWidgetLimit("99")).toBe(12);
    expect(parseWidgetLimit("8")).toBe(8);
  });

  it("drops ended items, keeps one already under way, sorts and limits", () => {
    const items = [
      item({ key: "c", startsOn: "2026-12-01", endsOn: "2026-12-01" }),
      item({ key: "ended", startsOn: "2026-11-01", endsOn: "2026-11-09" }),
      item({ key: "underway", startsOn: "2026-11-08", endsOn: "2026-11-11" }),
      item({ key: "a", startsOn: "2026-11-15", endsOn: "2026-11-15" }),
    ];
    expect(selectWidgetItems(items, { today, filter: "everything" }).map((i) => i.key)).toEqual(["underway", "a", "c"]);
    expect(selectWidgetItems(items, { today, filter: "everything", limit: 2 }).map((i) => i.key)).toEqual(["underway", "a"]);
  });

  it("shows a repeating series once", () => {
    const items = [
      item({ key: "r1", seriesId: "s", startsOn: "2026-11-12", endsOn: "2026-11-12" }),
      item({ key: "r2", seriesId: "s", startsOn: "2026-11-19", endsOn: "2026-11-19" }),
      item({ key: "one", startsOn: "2026-11-14", endsOn: "2026-11-14" }),
    ];
    expect(selectWidgetItems(items, { today, filter: "everything" }).map((i) => i.key)).toEqual(["r1", "one"]);
  });

  it("filters by group and category", () => {
    const items = [
      item({ key: "camp", category: "Camps" }),
      item({ key: "school", category: "Schools" }),
      item({ key: "other", category: "Retreat" }),
    ];
    expect(selectWidgetItems(items, { today, filter: "camps" }).map((i) => i.key)).toEqual(["camp"]);
    expect(selectWidgetItems(items, { today, filter: "main" }).map((i) => i.key).sort()).toEqual(["camp", "other"]);
    expect(selectWidgetItems(items, { today, category: "retreat" }).map((i) => i.key)).toEqual(["other"]);
  });
});

describe("widget selection edge cases (#107)", () => {
  const today = "2026-11-10";

  it("shows an event linked to several items (#1086) once, by its own dates", () => {
    const linked = { kind: "EVENT" as const, href: "/events/synthetic-camporee", eventTitle: "Synthetic Camporee", eventStartsOn: "2026-11-14", eventEndsOn: "2026-11-16" };
    const items = [
      item({ key: "link-b", ...linked, startsOn: "2026-11-15", endsOn: "2026-11-15" }),
      item({ key: "link-a", ...linked, startsOn: "2026-11-14", endsOn: "2026-11-14" }),
      item({ key: "other", startsOn: "2026-11-12", endsOn: "2026-11-12" }),
    ];
    expect(selectWidgetItems(items, { today, filter: "everything" }).map((i) => i.key)).toEqual(["other", "link-a"]);
  });

  it("uses the event's dates to decide an item is over", () => {
    const items = [item({ key: "late", kind: "EVENT", href: "/events/x", startsOn: "2026-11-01", endsOn: "2026-11-01", eventStartsOn: "2026-11-01", eventEndsOn: "2026-11-12" })];
    expect(selectWidgetItems(items, { today, filter: "everything" })).toHaveLength(1);
  });

  it("takes the first value of a repeated filter or category instead of throwing", () => {
    const items = [item({ key: "camp", category: "Camps" }), item({ key: "retreat", category: "Retreat" })];
    expect(selectWidgetItems(items, { today, category: ["retreat", "camps"] }).map((i) => i.key)).toEqual(["retreat"]);
    expect(parseWidgetLimit(["3", "9"])).toBe(3);
  });
});

describe("multi-day rendering (#107)", () => {
  it("shows a span as a range, across months and years", () => {
    expect(formatDateRange("2026-12-05", "2026-12-07")).toBe("December 5–7, 2026");
    expect(formatDateRange("2026-12-30", "2027-01-02")).toBe("Dec 30, 2026 – Jan 2, 2027");
  });
});

describe("embed code (#107)", () => {
  it("builds the iframe and host script with params", () => {
    const code = buildCalendarWidgetEmbedCode({ origin: "https://events.imsda.org/", filter: "camps", limit: 99 });
    expect(code).toContain('src="https://events.imsda.org/embed/calendar?filter=camps&amp;limit=12"');
    expect(code).toContain('title="IMSDA upcoming events"');
    expect(code).toContain('height="480"');
    expect(code).toContain('<script src="https://events.imsda.org/embed/embed-host.js" async></script>');
    expect(buildCalendarWidgetEmbedCode({ origin: "https://events.imsda.org" })).toContain('src="https://events.imsda.org/embed/calendar"');
  });

  it("escapes a hostile category", () => {
    const code = buildCalendarWidgetEmbedCode({ origin: "https://events.imsda.org", category: '"><script>x</script>' });
    expect(code).not.toContain('"><script>');
    expect(code).toContain("category=%22%3E%3Cscript%3Ex%3C%2Fscript%3E");
    expect(code.split("\n")[1]).toMatch(/^ {8}src="[^"]+"$/);
  });
});

describe("embedded calendar page (#107)", () => {
  it("shows only what the public read returns, with top-window links", async () => {
    listPublicCalendarItems.mockResolvedValue([
      item({ key: "event-1", kind: "EVENT", title: "Synthetic Camp Meeting", startsOn: "2026-11-20", endsOn: "2026-11-22", href: "/events/synthetic-camp", registrationOpen: true, location: "Camp Example", category: "Camps" }),
      item({ key: "entry-1", title: "Synthetic Rally", startsOn: "2026-11-25", endsOn: "2026-11-25", href: "https://example.org/rally", category: "Camps", status: "CANCELLED" }),
    ]);
    const { default: Page } = await import("@/app/(public)/embed/calendar/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ filter: "everything" }) }));
    expect(listPublicCalendarItems).toHaveBeenCalledWith("2026-11-10", "2027-11-10");
    expect(html).toContain("Upcoming events");
    expect(html).toContain("Synthetic Camp Meeting");
    expect(html).toContain("November 20–22, 2026");
    expect(html).toContain("IMSDA event");
    expect(html).toContain("Conference date");
    expect(html).toContain("Cancelled");
    expect(html).toContain('href="/events/synthetic-camp" target="_top"');
    expect(html).toContain('href="/calendar?view=list&amp;filter=everything"');
    expect(html).not.toContain("Not returned");
    // A cancelled entry still lists its title, but gets no "More info" action.
    expect(html).toContain("Synthetic Rally");
    expect(html).not.toContain("More info");
    expect(html).toContain("Register");
  });

  it("gives an external entry link target _top and rel", async () => {
    listPublicCalendarItems.mockResolvedValue([item({ key: "entry-2", title: "Synthetic Fair", href: "https://example.org/fair" })]);
    const { default: Page } = await import("@/app/(public)/embed/calendar/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ filter: "everything" }) }));
    expect(html).toContain('rel="noopener noreferrer" target="_top"');
  });

  it("words a waitlist action and strikes only cancelled items", async () => {
    listPublicCalendarItems.mockResolvedValue([
      item({ key: "event-w", kind: "EVENT", title: "Synthetic Waitlist Event", href: "/events/w", registrationOpen: true, registrationStatus: "WAITLIST" }),
      item({ key: "event-p", kind: "EVENT", title: "Synthetic Moved Event", href: "/events/p", status: "POSTPONED" }),
      item({ key: "entry-c", title: "Synthetic Cancelled Entry", status: "CANCELLED" }),
    ]);
    const { default: Page } = await import("@/app/(public)/embed/calendar/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ filter: ["everything", "camps"], category: ["a", "b"] }) }));
    expect(html).toContain("Join the waitlist");
    expect(html).toContain("Postponed");
    const lis = html.split("<li ").slice(1);
    const struck = (title: string) => /_off_|off/.test(lis.find((li) => li.includes(title))!.split(">")[0]);
    expect(struck("Synthetic Cancelled Entry")).toBe(true);
    expect(struck("Synthetic Moved Event")).toBe(false);
  });

  it("shows an empty state", async () => {
    listPublicCalendarItems.mockResolvedValue([]);
    const { default: Page } = await import("@/app/(public)/embed/calendar/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Nothing is on the calendar yet");
    expect(html).toContain("View full calendar");
  });
});

