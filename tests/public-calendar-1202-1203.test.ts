import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calendarToneMap,
  calendarItemTone,
  calendarKeyTone,
  filterByCategory,
  formatWeekdayDate,
  itemsOnDate,
  monthGrid,
  weekBarLayout,
  type CalendarItem,
} from "@/modules/calendar/domain";
import { CalendarSubscribe } from "@/components/calendar-subscribe";

afterEach(() => vi.useRealTimers());

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

const item = (key: string, startsOn: string, endsOn: string, overrides: Partial<CalendarItem> = {}): CalendarItem =>
  ({
    key,
    kind: "ENTRY",
    title: `Synthetic ${key}`,
    description: "",
    startsOn,
    endsOn,
    timeLabel: "",
    location: "",
    category: "Youth",
    href: null,
    status: "SCHEDULED",
    registrationOpen: false,
    ...overrides,
  }) as CalendarItem;

// March 2026: the first grid week is Sun Mar 1 - Sat Mar 7, the second Mar 8 - 14.
const marchGrid = monthGrid({ year: 2026, month: 3 });
const week1 = marchGrid[0];

describe("weekBarLayout (#1202)", () => {
  it("lays out nothing for an empty week", () => {
    expect(weekBarLayout(week1, [])).toEqual({ bars: [], hiddenByDay: [0, 0, 0, 0, 0, 0, 0] });
  });

  it("gives one single-day item a one-column bar in the first row", () => {
    const { bars, hiddenByDay } = weekBarLayout(week1, [item("a", "2026-03-04", "2026-03-04")]);
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ startCol: 4, span: 1, row: 0, continuesBefore: false, continuesAfter: false, segmentStart: "2026-03-04", segmentEnd: "2026-03-04" });
    expect(hiddenByDay.every((count) => count === 0)).toBe(true);
  });

  it("stacks four items on one day in four rows and counts nothing hidden", () => {
    const items = ["a", "b", "c", "d"].map((key) => item(key, "2026-03-02", "2026-03-02"));
    const { bars, hiddenByDay } = weekBarLayout(week1, items);
    expect(bars.map((bar) => bar.row).sort()).toEqual([0, 1, 2, 3]);
    expect(hiddenByDay).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("hides the items past four rows and counts them on the day (6 items: 4 bars, 2 more)", () => {
    const items = ["a", "b", "c", "d", "e", "f"].map((key) => item(key, "2026-03-02", "2026-03-02"));
    const { bars, hiddenByDay } = weekBarLayout(week1, items);
    expect(bars).toHaveLength(4);
    expect(hiddenByDay).toEqual([0, 2, 0, 0, 0, 0, 0]);
    // The panel still lists all six: nothing is ever dropped from the day's complete set.
    expect(itemsOnDate(items, "2026-03-02")).toHaveLength(6);
  });

  it("counts a hidden multi-day item on every day it covers", () => {
    const filler = ["a", "b", "c", "d"].map((key) => item(key, "2026-03-02", "2026-03-04"));
    const { bars, hiddenByDay } = weekBarLayout(week1, [...filler, item("late", "2026-03-03", "2026-03-03", { title: "Zed" })]);
    expect(bars).toHaveLength(4);
    expect(hiddenByDay).toEqual([0, 0, 1, 0, 0, 0, 0]);
  });

  it("clips items that cross weeks and flags the continuation", () => {
    const long = item("trip", "2026-02-23", "2026-03-17", { title: "Mission trips" });
    const first = weekBarLayout(week1, [long]).bars[0];
    expect(first).toMatchObject({ startCol: 1, span: 7, continuesBefore: true, continuesAfter: true, segmentStart: "2026-03-01", segmentEnd: "2026-03-07" });
    const last = weekBarLayout(marchGrid[2], [long]).bars[0];
    expect(last).toMatchObject({ startCol: 1, span: 3, continuesBefore: true, continuesAfter: false, segmentEnd: "2026-03-17" });
    expect(weekBarLayout(marchGrid[3], [long]).bars).toEqual([]);
  });

  it("clips an item that crosses the month boundary inside one grid week", () => {
    const feb = monthGrid({ year: 2026, month: 2 });
    const lastWeek = feb[feb.length - 1];
    expect(lastWeek[0]).toBe("2026-02-22");
    const bar = weekBarLayout(lastWeek, [item("hon", "2026-02-26", "2026-03-07")]).bars[0];
    expect(bar).toMatchObject({ startCol: 5, span: 3, continuesBefore: false, continuesAfter: true, segmentStart: "2026-02-26", segmentEnd: "2026-02-28" });
  });

  it("orders longest first, then earliest, then the calendar's own order, and fills the first free row", () => {
    const items = [
      item("short", "2026-03-02", "2026-03-02", { title: "Short" }),
      item("long", "2026-03-01", "2026-03-06", { title: "Long" }),
      item("mid-late", "2026-03-04", "2026-03-05", { title: "Mid late" }),
      item("mid-early", "2026-03-02", "2026-03-03", { title: "Mid early" }),
      item("mid-b", "2026-03-02", "2026-03-03", { title: "B second" }),
    ];
    const { bars } = weekBarLayout(week1, items);
    expect(bars.map((bar) => bar.item.key)).toEqual(["long", "mid-b", "mid-early", "mid-late", "short"]);
    const row = (key: string) => bars.find((bar) => bar.item.key === key)?.row;
    expect(row("long")).toBe(0);
    expect(row("mid-b")).toBe(1);
    expect(row("mid-early")).toBe(2);
    // Columns 4-5 are free in row 1, so the later two-day bar uses it; the one-day bar goes into the first row free at column 2.
    expect(row("mid-late")).toBe(1);
    expect(row("short")).toBe(3);
  });

  it("lays a closure out like any other item and tones it as closed", () => {
    const closure = item("closed", "2026-03-05", "2026-03-06", { isClosure: true, category: "Office closure" });
    const { bars } = weekBarLayout(week1, [closure]);
    expect(bars[0]).toMatchObject({ startCol: 5, span: 2 });
    expect(calendarItemTone(closure, calendarToneMap([]))).toBe("closure");
  });

  it("applies the category filter before the layout, so a filtered-out item never gets a bar", () => {
    const items = [item("a", "2026-03-02", "2026-03-02"), item("b", "2026-03-02", "2026-03-02", { category: "Camps" })];
    expect(weekBarLayout(week1, filterByCategory(items, "camps")).bars.map((bar) => bar.item.key)).toEqual(["b"]);
  });
});

describe("calendar tones (#1202, #1203)", () => {
  // The categories come sorted by name (calendarCategories), so tones follow that order.
  const names = ["Adventurers", "Camps", "Ministerial", "Pathfinders", "Women's Ministries", "Youth"];
  const entries = names.map((name, index) => item(`e${index}`, "2026-03-02", "2026-03-02", { category: name }));

  it("gives up to six categories six different tones, by position, skipping the closure category", () => {
    const closure = item("c", "2026-03-03", "2026-03-03", { category: "Office closure", isClosure: true });
    const map = calendarToneMap([closure, ...entries]);
    expect(calendarToneMap([closure, ...entries]).get("office closure")).toBeUndefined();
    expect(names.map((name) => calendarKeyTone(name, map))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(calendarKeyTone("Office closure", map)).toBe("closure");
    expect(calendarKeyTone(" youth ", map)).toBe(6);
    expect(calendarKeyTone("Unknown", map)).toBe(1);
  });

  it("gives categories that differ only in case one tone without shifting the others", () => {
    const variant = item("v", "2026-03-02", "2026-03-02", { category: "camps" });
    const map = calendarToneMap([...entries, variant]);
    expect(calendarItemTone(variant, map)).toBe(calendarItemTone(entries[1], map));
    expect([...map.values()]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("does not change when a category filter is applied, because the map is built from the unfiltered items", () => {
    const map = calendarToneMap(entries);
    const filtered = filterByCategory(entries, "youth");
    expect(calendarItemTone(filtered[0], map)).toBe(calendarItemTone(entries[5], map));
    expect(calendarItemTone(entries[0], map)).not.toBe(calendarItemTone(entries[5], map));
  });

  it("makes events navy and closures striped whatever the category", () => {
    const map = calendarToneMap(entries);
    expect(calendarItemTone(item("x", "2026-03-02", "2026-03-02", { kind: "EVENT", category: "Youth" }), map)).toBe("event");
    expect(calendarItemTone(item("y", "2026-03-02", "2026-03-02", { kind: "EVENT", category: "Youth", isClosure: true }), map)).toBe("closure");
    expect(calendarItemTone(entries[0], map)).toBe(1);
  });

  it("shows a category only IMSDA events use as navy in the key and gives it no tone slot", () => {
    const eventOnly = item("ev", "2026-03-02", "2026-03-02", { kind: "EVENT", category: "Aardvark Retreats" });
    const map = calendarToneMap([eventOnly, ...entries]);
    expect(calendarKeyTone("Aardvark Retreats", map)).toBe("event");
    // It sorts first, yet every entry category keeps the tone it would have had without it.
    expect(names.map((name) => calendarKeyTone(name, map))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("keeps the tone of a category used by both an event and an entry", () => {
    const both = [item("ev", "2026-03-02", "2026-03-02", { kind: "EVENT", category: "Youth" }), item("en", "2026-03-02", "2026-03-02", { category: "Youth" })];
    const map = calendarToneMap(both);
    expect(calendarKeyTone("Youth", map)).toBe(1);
    expect(calendarItemTone(both[0], map)).toBe("event");
    expect(calendarItemTone(both[1], map)).toBe(1);
  });

  it("names a day with its weekday", () => {
    expect(formatWeekdayDate("2026-03-02")).toBe("Monday, March 2, 2026");
  });

  it("defines six tones in the stylesheet with differing fill lightness", () => {
    const css = read("app/globals.css");
    const fills = [1, 2, 3, 4, 5, 6].map((tone) => css.match(new RegExp(`\\.calendar-tone-${tone} \\{ --cal-fill: (#[0-9a-f]{6}); --cal-edge: (#[0-9a-f]{6}); --cal-ink: (#[0-9a-f]{6});`)));
    expect(fills.every(Boolean)).toBe(true);
    const lightness = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => (Math.max(lightness(a), lightness(b)) + 0.05) / (Math.min(lightness(a), lightness(b)) + 0.05);
    for (const match of fills) expect(contrast(match![3], match![1])).toBeGreaterThanOrEqual(4.5);
    expect(new Set(fills.map((match) => Math.round(lightness(match![1]) * 20))).size).toBeGreaterThanOrEqual(6);
  });
});

describe("calendar page wiring (#1202, #1203)", () => {
  const page = read("app/(public)/calendar/page.tsx");
  const css = read("app/globals.css");

  it("draws bars per week from the layout, with continuation glyphs, date ranges and 'more' links", () => {
    expect(page).toContain("weekBarLayout(week, items)");
    expect(page).toContain('className="calendar-week"');
    expect(page).toContain("bar.continuesBefore");
    expect(page).toContain("bar.continuesAfter");
    expect(page).toContain("bar.span >= 3");
    expect(page).toContain("bar.segmentStart");
    expect(page).toContain("more ${hidden === 1");
    expect(page).toContain("calendar-more-link");
  });

  it("makes every day, empty or not, a real link with a weekday label and item count", () => {
    expect(page).toContain("aria-label={`${formatWeekdayDate(date)}, ${calendarCountLabel(dayItems.length)}`}");
    // The day link is outside the `dayItems.length > 0` condition.
    const link = page.indexOf('className="calendar-day-link"');
    const dots = page.indexOf('className="calendar-dots"');
    expect(link).toBeGreaterThan(0);
    expect(link).toBeLessThan(dots);
    expect(page.slice(link - 400, link)).not.toContain("dayItems.length > 0 ?");
  });

  it("keeps the phone dots decorative and still reads items only through the existing public set", () => {
    expect(page).toContain("CalendarMonthChip");
    expect(page).toContain("listPublicCalendarItems(from, to)");
    expect(page).toContain("filterByCategory(allItems, category)");
    const chip = read("components/calendar-month-chip.tsx");
    expect(chip).toContain('"aria-hidden": true');
    expect(chip).toContain("tabIndex: -1");
    expect(css).toMatch(/\.calendar-day \.calendar-dots \{ display: none; \}/);
  });

  it("fills the panel with the complete set for the day, through the agenda's link, and prompts when no day is chosen", () => {
    expect(page).toContain("itemsOnDate(items, selectedDate)");
    expect(page).toContain("sortCalendarItems(selectedItems).map((item, index) => <CalendarPanelItem");
    expect(page).toContain("Select a day to see everything on it.");
    expect(page).toContain("CalendarDayFocus");
    expect(page).toContain("Clear category");
    expect(page).toContain("Month agenda");
    const panelItem = read("components/calendar-panel-item.tsx");
    expect(panelItem).toContain("ItemLink");
    expect(panelItem).toContain("formatDateRange");
    expect(panelItem).toContain("calendarItemStatusLine");
    expect(css).toMatch(/@media \(min-width: 1001px\) \{\s*\.calendar-board \{ grid-template-columns: minmax\(0, 1fr\) 320px; \}/);
  });

  it("shows a colour swatch in each category button and a key for IMSDA events", () => {
    expect(page).toContain("calendarKeyTone(name, toneMap)");
    expect(css).toMatch(/\.calendar-categories \{ display: flex; flex-wrap: wrap;/);
    expect(css).toMatch(/\.calendar-day-detail \{ max-height: calc\(100vh - 24px\); overflow-y: auto; overscroll-behavior: contain; \}/);
    expect(css).toMatch(/\.calendar-bar-title \{ flex: 0 0 auto; max-width: 100%;/);
    expect(page).toContain('<span aria-hidden="true" className="calendar-swatch" />');
    expect(page).toContain("IMSDA event");
    expect(css).toMatch(/\.calendar-categories a \{\s*flex: none; display: inline-flex; min-height: 44px;/);
  });

  it("keeps the week height fixed, motion short and off for reduced motion", () => {
    expect(css).toMatch(/\.calendar-week \{ grid-template-rows: 48px repeat\(4, 38px\) 36px; height: 236px;/);
    expect(css).toMatch(/transition: filter 0\.2s ease;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.calendar-bar \{ transition: none; \}/);
    const start = css.indexOf("/* Month bars, category tones");
    const end = css.indexOf("/* Registration form builder editor shell (#1132)");
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(end);
  });
});

describe("calendar subscribe menu (#1203)", () => {
  const links = {
    google: "https://calendar.google.com/calendar/r?cid=synthetic",
    outlook: "https://outlook.live.com/calendar/0/addfromweb?url=synthetic",
    outlookWork: "https://outlook.office.com/calendar/0/addfromweb?url=synthetic",
    apple: "webcal://example.test/calendar.ics",
    webcalUrl: "webcal://example.test/calendar.ics",
    feedUrl: "https://example.test/calendar.ics",
  };
  const markup = renderToStaticMarkup(createElement(CalendarSubscribe, { links }));

  it("is one button that controls the choice list and keeps the section id", () => {
    expect(markup).toContain('id="subscribe"');
    expect(markup).toContain("Add these dates to my calendar");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls="calendar-subscribe-options"');
    expect(markup).toContain('id="calendar-subscribe-options"');
    expect(markup.match(/calendar-subscribe-toggle/g)?.length).toBe(1);
  });

  it("offers every option, with the same destinations as before", () => {
    for (const label of ["Google Calendar", "Outlook.com", "Outlook (work or school)", "Apple Calendar", "ICS link", "Copy link"]) expect(markup).toContain(label);
    for (const href of [links.google, links.outlook, links.outlookWork, links.apple, links.feedUrl]) expect(markup).toContain(`href="${href}"`);
  });

  it("keeps the copy fallback text, Escape handling and focus return in the component", () => {
    const source = read("components/calendar-subscribe.tsx");
    expect(source).toContain("Copy this link instead: ${links.feedUrl}");
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain("button.current?.focus()");
  });
});
