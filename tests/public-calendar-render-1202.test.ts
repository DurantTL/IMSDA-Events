import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarItem } from "@/modules/calendar/domain";

const make = (key: string, startsOn: string, endsOn: string, overrides: Partial<CalendarItem> = {}): CalendarItem =>
  ({
    key, kind: "ENTRY", title: `Synthetic ${key}`, description: "", startsOn, endsOn, timeLabel: "", location: "", category: "Youth",
    href: `/events/${key}`, status: "SCHEDULED", registrationOpen: false, ...overrides,
  }) as CalendarItem;

const items = [
  make("honors", "2026-02-26", "2026-03-07", { title: "Honors Weekend" }),
  make("trip", "2026-02-23", "2026-03-17", { title: "Mission Trips", category: "Camps" }),
  make("closed", "2026-03-13", "2026-03-13", { title: "Office closed day", isClosure: true, category: "Office closure" }),
  make("cancelled", "2026-03-12", "2026-03-12", { title: "Called off", status: "CANCELLED" }),
  ...["a", "b", "c", "d", "e", "f"].map((key) => make(`busy-${key}`, "2026-03-02", "2026-03-02", { title: `Busy ${key}` })),
  make("imsda", "2026-03-20", "2026-03-20", { title: "Synthetic Retreat", kind: "EVENT", registrationOpen: true, category: "" }),
];

vi.mock("server-only", () => ({}));
vi.mock("@/components/public-header-session-links", () => ({ PublicHeaderSessionLinks: () => null }));
vi.mock("@/modules/calendar/repository", () => ({
  conferenceToday: () => "2026-03-10",
  listPublicCalendarItems: async () => items,
}));

afterEach(() => vi.useRealTimers());

async function render(searchParams: Record<string, string>) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
  const { default: Page } = await import("@/app/(public)/calendar/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
}

describe("public calendar month render (#1202)", () => {
  it("draws bars with continuation glyphs, date ranges and accessible names", async () => {
    const markup = await render({ month: "2026-03", filter: "everything" });
    expect(markup).toContain('aria-label="Honors Weekend, February 26 – March 7, 2026"');
    expect(markup).toContain('aria-label="Office closed: Office closed day, March 13, 2026"');
    expect(markup).toContain('aria-label="Called off, March 12, 2026, Cancelled"');
    expect(markup).toContain("calendar-bar calendar-bar-row-");
    expect(markup).toContain("continues-before");
    expect(markup).toContain("continues-after");
    expect(markup).toContain("‹");
    expect(markup).toContain("›");
    expect(markup).toContain("calendar-bar-dates");
  });

  it("shows +N more on the busy day, with a full label, and every day is a link", async () => {
    const markup = await render({ month: "2026-03" });
    expect(markup).toMatch(/aria-label="\d+ more events? on Monday, March 2, 2026"/);
    expect(markup).toContain('aria-label="Monday, March 2, 2026, 8 events"');
    expect(markup).toContain('aria-label="Tuesday, March 31, 2026, 0 events"');
    expect(markup).toContain("Select a day to see only that day.");
  });

  it("keeps the phone dots, the key and the single subscribe button", async () => {
    const markup = await render({ month: "2026-03" });
    expect(markup).toContain("calendar-dots");
    expect(markup).toContain("calendar-chip");
    expect(markup).toContain("IMSDA event");
    expect(markup).toContain("calendar-swatch");
    expect(markup).toContain("Add to my calendar");
    expect(markup).toContain('id="subscribe"');
    expect(markup.match(/calendar-subscribe-toggle/g)?.length).toBe(1);
    expect(markup).not.toContain("calendar-subscribe-panel");
  });

  it("fills the panel with every item on the day, the same count as the day's complete set", async () => {
    const markup = await render({ month: "2026-03", date: "2026-03-02" });
    const panel = markup.slice(markup.indexOf('id="calendar-day-detail"'), markup.indexOf('class="calendar-key"'));
    expect(panel).toContain("8 events on March 2, 2026 in Main events.");
    expect(panel.match(/calendar-panel-item /g)?.length).toBe(8);
    expect(panel).toContain('href="/events/honors"');
  });

  it("applies the category filter to the panel and the bars", async () => {
    const markup = await render({ month: "2026-03", date: "2026-03-02", filter: "camps" });
    const panel = markup.slice(markup.indexOf('id="calendar-day-detail"'), markup.indexOf('class="calendar-key"'));
    expect(panel).toContain("1 event on March 2, 2026 in Camps.");
    expect(panel.match(/calendar-panel-item /g)?.length).toBe(1);
    expect(markup).not.toContain("Honors Weekend, February");
  });

  it("fills the panel with the legacy category link like the matching group", async () => {
    const markup = await render({ month: "2026-03", date: "2026-03-02", category: "Camps" });
    expect(markup).toContain("1 event on March 2, 2026 in Camps.");
  });
});

describe("public calendar compact month page (#1249)", () => {
  it("defaults to Main events: Schools, Meetings and closures are out, and the URL carries no filter", async () => {
    const markup = await render({ month: "2026-03" });
    expect(markup).not.toContain("Office closed day");
    expect(markup).toContain('aria-current="page" href="/calendar?month=2026-03">Main events');
    expect(markup).toContain('href="/calendar?month=2026-03&amp;filter=club"');
    expect(markup).toContain('href="/calendar?month=2026-03&amp;filter=everything"');
  });

  it("shows closures under Everything and keeps the chosen filter in the day and month links", async () => {
    const markup = await render({ month: "2026-03", filter: "everything" });
    expect(markup).toContain("Office closed day");
    expect(markup).toContain("filter=everything&amp;date=2026-03-05#calendar-day-detail");
  });

  it("keeps every colour the same whichever chip is chosen", async () => {
    const tones = (markup: string) => [...markup.matchAll(/calendar-tone-(\d|event|closure)[^"]*"[^>]*data-calendar-key="(honors|trip)"/g)].map((match) => `${match[2]}:${match[1]}`).sort();
    const everything = tones(await render({ month: "2026-03", filter: "everything" }));
    expect(everything.length).toBeGreaterThan(0);
    expect(tones(await render({ month: "2026-03", filter: "camps" }))).toEqual(everything.filter((entry) => entry.startsWith("trip:")));
  });

  it("lists the month beside the grid: the first three, then a disclosure for the rest", async () => {
    const markup = await render({ month: "2026-03", filter: "everything" });
    const list = markup.slice(markup.indexOf('id="calendar-month-list"'), markup.indexOf('class="calendar-key"'));
    expect(list).toContain("In March 2026");
    expect(list).toMatch(/Show \d+ more in March/);
    expect(list.split("<details")[0].match(/calendar-panel-item /g)?.length).toBe(3);
  });

  it("puts the view tabs and the filter chips in one sticky bar, and drops the agenda and the subscribe box", async () => {
    const markup = await render({ month: "2026-03" });
    expect(markup).toContain("calendar-sticky-bar");
    expect(markup).toContain('aria-label="Calendar view"');
    expect(markup).toContain("Today");
    expect(markup).not.toContain('class="calendar-agenda"');
    expect(markup).not.toContain("calendar-subscribe-panel");
  });
});
