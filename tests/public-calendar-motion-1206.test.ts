import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calendarBarIntroDelay,
  calendarDateFromHref,
  calendarFlipDelta,
  calendarFlipId,
  calendarSelectedKey,
  calendarSlideDirection,
  parseCalendarSelection,
  serializeCalendarSelection,
} from "@/components/calendar-motion-helpers";
import type { CalendarItem } from "@/modules/calendar/domain";

const make = (key: string, startsOn: string, endsOn: string, overrides: Partial<CalendarItem> = {}): CalendarItem =>
  ({
    key, kind: "ENTRY", title: `Synthetic ${key}`, description: "", startsOn, endsOn, timeLabel: "", location: "", category: "Youth",
    href: `/events/${key}`, status: "SCHEDULED", registrationOpen: false, ...overrides,
  }) as CalendarItem;

const items = [
  make("honors", "2026-03-04", "2026-03-12", { title: "Honors Weekend" }),
  make("retreat", "2026-03-10", "2026-03-10", { title: "Day Retreat" }),
  make("camp", "2026-03-10", "2026-03-10", { title: "Day Camp" }),
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

describe("public calendar motion markup (#1206)", () => {
  it("gives every bar and chip of an event the same data-calendar-key", async () => {
    const markup = await render({ month: "2026-03" });
    // Honors Weekend spans two weeks, so two bars share one key; chips carry it too.
    expect(markup.match(/class="calendar-bar[^"]*"[^>]*data-calendar-key="honors"/g)?.length).toBe(2);
    expect(markup).toMatch(/<li class="calendar-chip[^"]*" data-calendar-key="retreat"/);
  });

  it("indexes day panel items for the staggered rise", async () => {
    const markup = await render({ month: "2026-03", date: "2026-03-10" });
    const panel = markup.slice(markup.indexOf("calendar-panel-list"));
    expect(panel).toContain("--i:0");
    expect(panel).toContain("--i:1");
  });

  it("mounts the motion component only in the month view", async () => {
    expect(await render({ view: "list" })).not.toContain("data-calendar-key");
  });

  it("sets the staggered intro delay on bars", async () => {
    expect(await render({ month: "2026-03" })).toMatch(/--cal-delay:\d+ms/);
  });
});

describe("public calendar motion helpers (#1206)", () => {
  it("slides by month direction and not at all without a change", () => {
    expect(calendarSlideDirection("2026-03", "2026-04")).toBe("next");
    expect(calendarSlideDirection("2026-03", "2026-02")).toBe("prev");
    expect(calendarSlideDirection("2025-12", "2026-01")).toBe("next");
    expect(calendarSlideDirection("2026-03", "2026-03")).toBeNull();
    expect(calendarSlideDirection(null, "2026-03")).toBeNull();
  });

  it("staggers bar intro by week, column and row and caps the total", () => {
    expect(calendarBarIntroDelay(0, 1, 0)).toBe(0);
    expect(calendarBarIntroDelay(1, 3, 1)).toBeGreaterThan(calendarBarIntroDelay(0, 3, 1));
    expect(calendarBarIntroDelay(5, 7, 3)).toBeLessThanOrEqual(400);
  });

  it("keeps a clicked event selected only for its own day panel", () => {
    const stored = parseCalendarSelection(serializeCalendarSelection({ key: "honors", date: "2026-03-02" }));
    expect(calendarSelectedKey(stored, "2026-03-02")).toBe("honors");
    expect(calendarSelectedKey(stored, "2026-03-03")).toBeNull();
    expect(calendarSelectedKey(stored, "")).toBeNull();
    expect(calendarSelectedKey(null, "2026-03-02")).toBeNull();
    expect(parseCalendarSelection("not json")).toBeNull();
    expect(parseCalendarSelection('{"key":1}')).toBeNull();
  });

  it("reads the opened date from a day link and builds FLIP ids and deltas", () => {
    expect(calendarDateFromHref("/calendar?month=2026-03&date=2026-03-02#calendar-day-detail")).toBe("2026-03-02");
    expect(calendarDateFromHref("/calendar")).toBeNull();
    expect(calendarFlipId("bar", "honors", "calendar-day-2026-03-01")).toBe("bar:honors:calendar-day-2026-03-01");
    const box = { left: 10, top: 20, width: 100, height: 30 };
    expect(calendarFlipDelta(box, { ...box, top: 50 })).toEqual({ dx: 0, dy: -30 });
    expect(calendarFlipDelta(box, { ...box, left: 10.4 })).toBeNull();
  });
});

describe("public calendar motion css (#1206)", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const start = css.indexOf("/* Calendar motion (#1206)");
  const block = css.slice(start, css.indexOf(".calendar-subscribe-menu {", start));

  it("is placed before the form builder shell marker", () => {
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(css.indexOf("/* Registration form builder editor shell (#1132)"));
  });

  it("keeps every keyframe and animation inside a no-preference guard", () => {
    const outside = block.replace(/@media [^{]*prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\n\}\n/g, "");
    expect(block).toContain("@keyframes calendar-rise");
    expect(outside).not.toMatch(/@keyframes|animation\s*:|transition\s*:/);
  });

  it("never fades text below 0.4 opacity and adds no hover rules or pointer-events changes", () => {
    expect(block).not.toMatch(/:hover/);
    expect(block).not.toMatch(/pointer-events/);
    expect(block).not.toMatch(/animation:[^;]*infinite/);
    for (const [, value] of block.matchAll(/opacity:\s*([\d.]+)/g)) expect(Number(value)).toBeGreaterThanOrEqual(0.4);
  });

  it("gates the intro on the html attribute and runs the gold pulse once", () => {
    expect(block).toContain(":root:not([data-calendar-intro-done]) .calendar-bar");
    expect(block).toMatch(/calendar-today-pulse 0\.6s ease-out 0\.4s 1 /);
    expect(block).toContain("--imsda-gold");
  });
});
