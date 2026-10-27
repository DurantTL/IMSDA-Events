import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calendarToneMap, type CalendarItem } from "@/modules/calendar/domain";
import { calendarHref, calendarViews, parseCalendarView } from "@/modules/calendar/calendar-href";
import { buildCalendarYear, parseYearDate, parseYearParam } from "@/modules/calendar/year";

const make = (key: string, startsOn: string, endsOn: string, overrides: Partial<CalendarItem> = {}): CalendarItem =>
  ({
    key, kind: "ENTRY", title: `Synthetic ${key}`, description: "", startsOn, endsOn, timeLabel: "", location: "", category: "Camps",
    href: null, status: "SCHEDULED", registrationOpen: false, ...overrides,
  }) as CalendarItem;

const build = (year: number, items: CalendarItem[]) => buildCalendarYear(year, items, calendarToneMap(items));
const day = (year: ReturnType<typeof build>, date: string) => year.months[Number(date.slice(5, 7)) - 1].days.find((entry) => entry.date === date)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("buildCalendarYear (#1250)", () => {
  it("has twelve months with the right day counts, a leap February and Saturday as the Sabbath", () => {
    const plain = build(2027, []);
    expect(plain.months.map((month) => month.key)).toEqual(Array.from({ length: 12 }, (_, index) => `2027-${String(index + 1).padStart(2, "0")}`));
    expect(plain.months.map((month) => month.days.length)).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
    expect(build(2028, []).months[1].days).toHaveLength(29);
    expect(plain.months[0].name).toBe("January");
    expect(plain.months[2].label).toBe("March 2027");
    const sabbaths = plain.months[2].days.filter((entry) => entry.isSabbath).map((entry) => entry.date);
    expect(sabbaths).toEqual(["2027-03-06", "2027-03-13", "2027-03-20", "2027-03-27"]);
    expect(plain.months.flatMap((month) => month.days).every((entry) => entry.isSabbath === (entry.weekday === 6))).toBe(true);
  });

  it("builds Sunday-first week rows padded with empty cells", () => {
    const march = build(2027, []).months[2];
    // March 1, 2027 is a Monday.
    expect(march.weeks[0].map((cell) => cell?.day ?? null)).toEqual([null, 1, 2, 3, 4, 5, 6]);
    expect(march.weeks.every((week) => week.length === 7)).toBe(true);
    expect(march.weeks.flat().filter(Boolean)).toHaveLength(31);
    expect(march.weeks[march.weeks.length - 1].map((cell) => cell?.day ?? null)).toEqual([28, 29, 30, 31, null, null, null]);
  });

  it("marks a single-day item as a dot and counts it", () => {
    const year = build(2027, [make("a", "2027-03-06", "2027-03-06")]);
    const entry = day(year, "2027-03-06");
    expect(entry.count).toBe(1);
    expect(entry.marks).toHaveLength(1);
    expect(entry.marks[0]).toMatchObject({ shape: "dot", lane: 0 });
    expect(day(year, "2027-03-07")).toMatchObject({ count: 0, marks: [] });
  });

  it("draws a multi-day item as a joined bar in the same lane, cut at the month edge", () => {
    const year = build(2027, [make("break", "2027-03-29", "2027-04-03"), make("one", "2027-03-30", "2027-03-30")]);
    const march = ["2027-03-29", "2027-03-30", "2027-03-31"].map((date) => day(year, date).marks.find((mark) => mark.itemKey === "break")!);
    expect(march.map((mark) => mark.part)).toEqual(["start", "middle", "end"]);
    expect(march[2].continuesAfter).toBe(true);
    expect(march[0].continuesBefore).toBe(false);
    const april = ["2027-04-01", "2027-04-02", "2027-04-03"].map((date) => day(year, date).marks.find((mark) => mark.itemKey === "break")!);
    expect(april.map((mark) => mark.part)).toEqual(["start", "middle", "end"]);
    expect(april[0].continuesBefore).toBe(true);
    expect(april[2].continuesAfter).toBe(false);
    expect(new Set([...march, ...april].map((mark) => mark.lane)).size).toBe(1);
    // The one-day item beside it takes the other lane.
    expect(day(year, "2027-03-30").marks.map((mark) => mark.lane)).toEqual([0, 1]);
  });

  it("cuts a bar at Jan 1 and Dec 31 and keeps the break in both years", () => {
    const breakItem = make("winter", "2026-12-28", "2027-01-03");
    const next = build(2027, [breakItem]);
    expect(day(next, "2027-01-01").marks[0]).toMatchObject({ shape: "bar", part: "start", continuesBefore: true, continuesAfter: false });
    expect(day(next, "2027-01-03").marks[0]).toMatchObject({ part: "end", continuesAfter: false });
    expect(day(next, "2027-01-04").count).toBe(0);
    expect(next.months[11].items).toHaveLength(0);
    const previous = build(2026, [breakItem]);
    expect(day(previous, "2026-12-30").marks[0]).toMatchObject({ part: "middle" });
    expect(day(previous, "2026-12-31").marks[0]).toMatchObject({ part: "end", continuesAfter: true });
    expect(previous.months[0].items).toHaveLength(0);
    expect(previous.months[11].items.map((item) => item.key)).toEqual(["winter"]);
  });

  it("shows at most two marks and counts every item on the day", () => {
    const year = build(2027, ["a", "b", "c", "d"].map((key) => make(key, "2027-05-04", "2027-05-04")));
    const entry = day(year, "2027-05-04");
    expect(entry.count).toBe(4);
    expect(entry.marks).toHaveLength(2);
  });

  it("gives a day with items but no free lane a neutral overflow mark", () => {
    // Two long breaks hold both lanes through March 10; a third item starts on March 3 with no lane and runs on to March 20.
    const items = [make("a", "2027-03-01", "2027-03-10"), make("b", "2027-03-01", "2027-03-10"), make("c", "2027-03-03", "2027-03-20")];
    const year = build(2027, items);
    expect(day(year, "2027-03-05").marks).toHaveLength(2);
    expect(day(year, "2027-03-05").count).toBe(3);
    expect(day(year, "2027-03-15")).toMatchObject({ count: 1 });
    expect(day(year, "2027-03-15").marks).toEqual([expect.objectContaining({ shape: "overflow" })]);
  });

  it("keeps every day with items marked in a dense year", () => {
    const items: CalendarItem[] = [];
    for (let index = 0; index < 150; index += 1) {
      const start = new Date(Date.UTC(2027, 0, 1) + ((index * 37) % 360) * 86_400_000);
      const length = index % 3 === 0 ? 0 : (index * 7) % 12;
      const end = new Date(start.getTime() + length * 86_400_000);
      items.push(make(`dense-${index}`, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), { category: index % 2 ? "Schools" : "Camps" }));
    }
    const year = build(2027, items);
    const days = year.months.flatMap((month) => month.days);
    expect(days).toHaveLength(365);
    for (const entry of days) {
      const expected = items.filter((item) => item.startsOn <= entry.date && item.endsOn >= entry.date).length;
      expect(entry.count).toBe(expected);
      expect(entry.marks.length).toBeLessThanOrEqual(2);
      expect(entry.marks.length > 0).toBe(expected > 0);
    }
    // Every item shows in each month it overlaps, and in no other.
    for (const month of year.months) {
      const expected = items.filter((item) => item.startsOn <= `${month.key}-31` && item.endsOn >= `${month.key}-01`).length;
      expect(month.items).toHaveLength(expected);
    }
  });

  it("uses the month page's tones, with closures on the closure tone", () => {
    const items = [make("camp", "2027-06-01", "2027-06-01"), make("closed", "2027-07-05", "2027-07-05", { isClosure: true, category: "Office closure" })];
    const year = build(2027, items);
    expect(day(year, "2027-06-01").marks[0].tone).toBe(1);
    expect(day(year, "2027-07-05").marks[0]).toMatchObject({ tone: "closure", isClosure: true });
  });

  it("lists a repeating series once per month", () => {
    const items = [1, 8, 15].map((dayOfMonth) => make(`rep-${dayOfMonth}`, `2027-02-${String(dayOfMonth).padStart(2, "0")}`, `2027-02-${String(dayOfMonth).padStart(2, "0")}`, { seriesId: "series" }));
    const february = build(2027, items).months[1];
    expect(february.items).toHaveLength(1);
    expect(february.days.filter((entry) => entry.count > 0)).toHaveLength(3);
  });
});

describe("year params and links (#1250)", () => {
  it("bounds the year like the month param", () => {
    expect(parseYearParam("2027", "2026-10-27")).toBe(2027);
    expect(parseYearParam("2031", "2026-10-27")).toBe(2031);
    expect(parseYearParam("2032", "2026-10-27")).toBe(2026);
    expect(parseYearParam("abc", "2026-10-27")).toBe(2026);
    expect(parseYearParam("27", "2026-10-27")).toBe(2026);
    expect(parseYearParam(undefined, "2026-10-27")).toBe(2026);
  });

  it("honours a date only when it is real and inside the year", () => {
    expect(parseYearDate("2027-03-06", 2027)).toBe("2027-03-06");
    expect(parseYearDate("2027-02-30", 2027)).toBeUndefined();
    expect(parseYearDate("2026-12-31", 2027)).toBeUndefined();
    expect(parseYearDate(undefined, 2027)).toBeUndefined();
  });

  it("builds year links with the filter and date, and knows the year view", () => {
    expect(calendarViews).toContain("year");
    expect(parseCalendarView("year")).toBe("year");
    expect(calendarHref({ view: "year", year: "2027", filter: "club", date: "2027-03-06" }, "calendar-year-detail"))
      .toBe("/calendar?view=year&year=2027&filter=club&date=2027-03-06#calendar-year-detail");
    expect(calendarHref({ view: "year", year: "2027", filter: "main" })).toBe("/calendar?view=year&year=2027");
  });
});
