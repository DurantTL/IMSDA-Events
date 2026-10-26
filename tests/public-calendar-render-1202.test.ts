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
  make("closed", "2026-03-05", "2026-03-05", { title: "Office closed day", isClosure: true, category: "Office closure" }),
  make("cancelled", "2026-03-03", "2026-03-03", { title: "Called off", status: "CANCELLED" }),
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
    const markup = await render({ month: "2026-03" });
    expect(markup).toContain('aria-label="Honors Weekend, February 26 – March 7, 2026"');
    expect(markup).toContain('aria-label="Office closed: Office closed day, March 5, 2026"');
    expect(markup).toContain('aria-label="Called off, March 3, 2026, Cancelled"');
    expect(markup).toContain("calendar-bar calendar-tone-");
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
    expect(markup).toContain("Select a day to see everything on it.");
  });

  it("keeps the phone dots, the key and the single subscribe button", async () => {
    const markup = await render({ month: "2026-03" });
    expect(markup).toContain("calendar-dots");
    expect(markup).toContain("calendar-chip");
    expect(markup).toContain("IMSDA event");
    expect(markup).toContain("calendar-swatch");
    expect(markup).toContain("Add these dates to my calendar");
    expect(markup).toContain('id="subscribe"');
  });

  it("fills the panel with every item on the day, the same count as the day's complete set", async () => {
    const markup = await render({ month: "2026-03", date: "2026-03-02" });
    const panel = markup.slice(markup.indexOf('id="calendar-day-detail"'), markup.indexOf('class="calendar-agenda"'));
    expect(panel).toContain("8 events on March 2, 2026.");
    expect(panel.match(/calendar-panel-item /g)?.length).toBe(8);
    expect(panel).toContain('href="/events/honors"');
  });

  it("applies the category filter to the panel and the bars", async () => {
    const markup = await render({ month: "2026-03", date: "2026-03-02", category: "Camps" });
    const panel = markup.slice(markup.indexOf('id="calendar-day-detail"'), markup.indexOf('class="calendar-agenda"'));
    expect(panel).toContain("1 event on March 2, 2026 in Camps.");
    expect(panel.match(/calendar-panel-item /g)?.length).toBe(1);
    expect(markup).not.toContain("Honors Weekend, February");
  });
});
