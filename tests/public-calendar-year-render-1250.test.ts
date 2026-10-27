import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarItem } from "@/modules/calendar/domain";

const make = (key: string, startsOn: string, endsOn: string, overrides: Partial<CalendarItem> = {}): CalendarItem =>
  ({
    key, kind: "ENTRY", title: `Synthetic ${key}`, description: "", startsOn, endsOn, timeLabel: "", location: "", category: "Camps",
    href: `/events/${key}`, status: "SCHEDULED", registrationOpen: false, ...overrides,
  }) as CalendarItem;

const items = [
  make("camp", "2027-03-06", "2027-03-06", { title: "Synthetic Camp Day" }),
  make("retreat", "2027-03-06", "2027-03-08", { title: "Synthetic Retreat", category: "Ministries" }),
  make("pathfinders", "2027-04-10", "2027-04-10", { title: "Synthetic Pathfinder Day", category: "Pathfinders" }),
  make("school", "2027-03-29", "2027-04-02", { title: "Synthetic Spring Break", category: "Schools" }),
  make("closed", "2027-05-31", "2027-05-31", { title: "Synthetic Office closed", isClosure: true, category: "Office closure" }),
  make("today", "2026-10-27", "2026-10-27", { title: "Synthetic Today Item" }),
  ...Array.from({ length: 10 }, (_, index) => make(`many-${index}`, `2027-08-${String(index + 1).padStart(2, "0")}`, `2027-08-${String(index + 1).padStart(2, "0")}`, { title: `Synthetic Many ${index}` })),
];

vi.mock("server-only", () => ({}));
vi.mock("@/components/public-header-session-links", () => ({ PublicHeaderSessionLinks: () => null }));
vi.mock("@/modules/calendar/repository", () => ({
  conferenceToday: () => "2026-10-27",
  listPublicCalendarItems: async (from: string, to: string) => items.filter((item) => item.startsOn <= to && item.endsOn >= from),
}));

afterEach(() => vi.useRealTimers());

async function render(searchParams: Record<string, string>) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
  const { default: Page } = await import("@/app/(public)/calendar/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
}

const grid = (markup: string) => markup.slice(markup.indexOf('class="calendar-year-grid"'), markup.indexOf('class="calendar-year-rows"'));
const rows = (markup: string) => markup.slice(markup.indexOf('class="calendar-year-rows"'), markup.indexOf('id="calendar-year-detail"'));

describe("public calendar Year view render (#1250)", () => {
  it("adds a Year tab and the year navigation", async () => {
    const markup = await render({ view: "year", year: "2027" });
    expect(markup).toContain('aria-current="page" href="/calendar?view=year&amp;year=2027"');
    expect(markup).toMatch(/Year<\/a>/);
    expect(markup).toContain('aria-label="Previous year, 2026"');
    expect(markup).toContain('aria-label="Next year, 2028"');
    expect(markup).toContain("This year");
    expect(markup).toContain("<h2 aria-live=\"polite\">2027</h2>");
    expect(markup).toContain('href="/calendar?view=year&amp;year=2026"');
    const month = await render({ month: "2027-03" });
    expect(month).toContain('href="/calendar?view=year&amp;year=2027"');
    expect(month).toContain('aria-label="Previous month, February 2027"');
  });

  it("sends the Month tab to January of the shown year, or the current month in today's year", async () => {
    expect(await render({ view: "year", year: "2027" })).toContain('href="/calendar?month=2027-01">');
    expect(await render({ view: "year", year: "2026" })).toContain('href="/calendar">');
  });

  it("renders twelve months with month-name links that keep the filter", async () => {
    const markup = await render({ view: "year", year: "2027", filter: "club" });
    expect(grid(markup).match(/class="calendar-year-month"/g)).toHaveLength(12);
    expect(grid(markup)).toContain('href="/calendar?month=2027-01&amp;filter=club"');
    expect(grid(markup)).toContain('href="/calendar?month=2027-12&amp;filter=club"');
    expect(markup).not.toContain('class="calendar-month"');
  });

  it("opens on Main events: schools and closures are out", async () => {
    const markup = await render({ view: "year", year: "2027" });
    expect(markup).toContain('aria-current="page" href="/calendar?view=year&amp;year=2027">Main events');
    expect(markup).toContain("Synthetic Camp Day");
    expect(markup).not.toContain("Synthetic Spring Break");
    expect(markup).not.toContain("Synthetic Office closed");
  });

  it("makes marked days links with item-count labels, and leaves other days as plain text", async () => {
    const markup = await render({ view: "year", year: "2027" });
    const days = grid(markup);
    expect(days).toContain('aria-label="Saturday, March 6, 2027, 2 items"');
    expect(days).toContain('href="/calendar?view=year&amp;year=2027&amp;date=2027-03-06#calendar-year-detail"');
    expect(days).toContain('aria-label="Sunday, March 7, 2027, 1 item"');
    expect(days).not.toContain('aria-label="Monday, March 1, 2027');
    // Three days in March, April 10 and the ten in August are the only links.
    expect(days.match(/<a [^>]*calendar-year-day/g)?.length).toBe(3 + 1 + 10);
  });

  it("marks a multi-day item as a bar and draws today", async () => {
    const markup = await render({ view: "year", year: "2026" });
    expect(markup).toContain("calendar-year-day is-today has-items");
    expect(markup).toContain('aria-current="date"');
    const bars = await render({ view: "year", year: "2027" });
    expect(bars).toContain("calendar-year-mark calendar-tone-");
    expect(bars).toContain("is-bar is-start");
    expect(bars).toContain("is-bar is-end");
    expect(bars).toContain("is-dot");
  });

  it("lists the year in the side panel: the first eight, then the rest behind a disclosure", async () => {
    const markup = await render({ view: "year", year: "2027", filter: "everything" });
    const panel = markup.slice(markup.indexOf('id="calendar-year-detail"'), markup.indexOf('class="calendar-key"'));
    expect(panel).toContain("In 2027");
    expect(panel).toMatch(/\d+ items in Everything\./);
    expect(panel.split("<details")[0].match(/calendar-panel-item /g)).toHaveLength(8);
    expect(panel).toMatch(/Show all 15 in the list/);
    expect(panel.split("<details")[1].match(/calendar-panel-item /g)).toHaveLength(7);
  });

  it("shows the picked day's items with a way back to the year's list", async () => {
    const markup = await render({ view: "year", year: "2027", date: "2027-03-06", filter: "club" });
    const panel = markup.slice(markup.indexOf('id="calendar-year-detail"'), markup.indexOf('class="calendar-key"'));
    expect(panel).toContain("Events on March 6, 2027");
    expect(panel).toContain("Nothing on March 6, 2027 in Club events.");
    expect(panel).toContain("Back to the year&#x27;s list");
    expect(panel).toContain('href="/calendar?view=year&amp;year=2027&amp;filter=club#calendar-year-detail"');
    const main = await render({ view: "year", year: "2027", date: "2027-03-06" });
    expect(main).toContain("2 items on March 6, 2027 in Main events.");
    expect(main).toContain('aria-current="true"');
    expect(main).toContain("is-selected");
  });

  it("ignores a date outside the year", async () => {
    const markup = await render({ view: "year", year: "2027", date: "2026-03-06" });
    expect(markup).toContain("In 2027");
    expect(markup).not.toContain("Events on");
  });

  it("falls back to this year for a year outside the span", async () => {
    expect(await render({ view: "year", year: "2090" })).toContain("<h2 aria-live=\"polite\">2026</h2>");
  });

  it("renders twelve phone rows, each one link with the month's count and names", async () => {
    const markup = await render({ view: "year", year: "2027", filter: "everything" });
    const list = rows(markup);
    expect(list.match(/class="calendar-year-row"/g)).toHaveLength(12);
    expect(list).toContain('aria-label="March 2027, 3 items"');
    expect(list).toContain('href="/calendar?month=2027-03&amp;filter=everything#calendar-month-list"');
    expect(list).toContain("and 7 more");
    expect(list).toContain('aria-label="July 2027, 0 items"');
    expect(list.match(/calendar-year-slot/g)?.length).toBe(365);
    expect(list).not.toContain("<button");
  });

  it("shows closures in the closure style under Everything and keeps deadlines out", async () => {
    const markup = await render({ view: "year", year: "2027", filter: "everything" });
    expect(markup).toContain("Synthetic Office closed");
    expect(grid(markup)).toContain("calendar-year-mark calendar-tone-closure is-dot is-closure");
    expect(markup).toContain("calendar-panel-item calendar-tone-closure");
  });

  it("keeps the year in the chips", async () => {
    const markup = await render({ view: "year", year: "2027", date: "2027-03-06" });
    expect(markup).toContain('href="/calendar?view=year&amp;year=2027&amp;filter=club&amp;date=2027-03-06"');
  });
});
