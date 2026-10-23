import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  calendarCountLabel,
  filterByCategory,
  formatLongDate,
  itemsOnDate,
  parseDateParam,
  resolveMonthAndDate,
  type CalendarItem,
} from "@/modules/calendar/domain";

const today = "2027-04-01";

const item = (key: string, startsOn: string, endsOn: string, overrides: Partial<CalendarItem> = {}): CalendarItem =>
  ({
    key,
    kind: "ENTRY",
    title: `Synthetic ${key}`,
    startsOn,
    endsOn,
    status: "SCHEDULED",
    category: "Youth",
    ...overrides,
  }) as CalendarItem;

describe("calendar day agenda (#1117)", () => {
  it("accepts only real dates inside the month span", () => {
    expect(parseDateParam("2027-04-24", today)).toBe("2027-04-24");
    expect(parseDateParam("2027-02-30", today)).toBeUndefined();
    expect(parseDateParam("2027-4-24", today)).toBeUndefined();
    expect(parseDateParam("2099-04-24", today)).toBeUndefined();
    expect(parseDateParam(undefined, today)).toBeUndefined();
  });

  it("formats the date and counts in words", () => {
    expect(formatLongDate("2027-04-24")).toBe("April 24, 2027");
    expect(calendarCountLabel(0)).toBe("0 events");
    expect(calendarCountLabel(1)).toBe("1 event");
    expect(calendarCountLabel(5)).toBe("5 events");
  });

  it("returns every item for a date, including multi-day overlaps and the active category only", () => {
    const items = [
      item("a", "2027-04-24", "2027-04-24"),
      item("b", "2027-04-23", "2027-04-25"),
      item("c", "2027-04-24", "2027-04-24", { category: "Camps" }),
      item("d", "2027-04-24", "2027-04-24", { status: "CANCELLED" }),
      item("e", "2027-04-24", "2027-04-24", { status: "POSTPONED" }),
      item("f", "2027-04-26", "2027-04-26"),
    ];
    expect(itemsOnDate(items, "2027-04-24").map((entry) => entry.key)).toEqual(["a", "b", "c", "d", "e"]);
    expect(itemsOnDate(filterByCategory(items, "youth"), "2027-04-24").map((entry) => entry.key)).toEqual(["a", "b", "d", "e"]);
    expect(itemsOnDate(items, "2027-04-27")).toEqual([]);
  });
});

describe("month and date resolution (#1117)", () => {
  it("opens an adjacent-month date on its own month", () => {
    expect(resolveMonthAndDate("month", "2027-04", "2027-05-01", today)).toEqual({ selectedDate: "2027-05-01", month: { year: 2027, month: 5 } });
  });
  it("lets the date win over a mismatched month", () => {
    expect(resolveMonthAndDate("month", "2027-09", "2027-04-24", today).month).toEqual({ year: 2027, month: 4 });
  });
  it("shows no panel for a date beyond five years and keeps the month param", () => {
    expect(resolveMonthAndDate("month", "2027-06", "2040-01-01", today)).toEqual({ selectedDate: undefined, month: { year: 2027, month: 6 } });
  });
  it("ignores the date in list view", () => {
    expect(resolveMonthAndDate("list", undefined, "2027-04-24", today).selectedDate).toBeUndefined();
  });
});

describe("calendar page wiring (#1117)", () => {
  const page = readFileSync(path.join(process.cwd(), "app/(public)/calendar/page.tsx"), "utf8");
  const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
  const chip = readFileSync(path.join(process.cwd(), "components/calendar-month-chip.tsx"), "utf8");

  it("links crowded days and day numbers to the dated agenda with a counted label", () => {
    expect(page).toContain("calendar-more-link");
    expect(page).toContain("events for {formatLongDate(date)}");
    expect(page).toContain("calendar-day-detail");
    expect(page).toContain("Clear category");
    expect(page).toContain("Back to {monthLabel(month)}");
  });

  it("opens an adjacent-month date on its own month and keeps the category", () => {
    expect(page).toContain("date.slice(0, 7)");
    expect(page).toContain("category, date },");
  });

  it("keeps the phone dots decorative and gives the day link a 44px target", () => {
    expect(chip).toContain('"aria-hidden": true');
    expect(chip).toContain("tabIndex: -1");
    expect(css).toMatch(/\.calendar-day-link \{ width: 100%; min-height: 44px;/);
  });
});
