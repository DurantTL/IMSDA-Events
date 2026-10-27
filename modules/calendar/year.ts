/**
 * The public calendar's Year view (#1250), built on the server as plain data: twelve months, each with its days, the marks every
 * day shows and the week rows of the desktop mini grid. Everything here is pure.
 *
 * Items are bucketed into day slots by looping each item's clamped date range once, so a feed of 100+ entries (many overlapping
 * multi-day school breaks) costs one pass over the item-days, not items x days.
 */

import {
  calendarItemTone,
  calendarMonthSpanYears,
  firstPerSeries,
  isCalendarDate,
  monthLabel,
  sortCalendarItems,
  type CalendarItem,
  type CalendarTone,
} from "@/modules/calendar/domain";

/** `?year=2027`, bounded like the month param: within the month span of today, else today's year. */
export function parseYearParam(value: string | undefined, today: string): number {
  const todayYear = Number(today.slice(0, 4));
  if (value && /^\d{4}$/.test(value) && Math.abs(Number(value) - todayYear) <= calendarMonthSpanYears) return Number(value);
  return todayYear;
}

/** The `date` query value in the Year view: a real calendar date inside the shown year, else undefined (the year's list shows). */
export function parseYearDate(value: string | undefined, year: number): string | undefined {
  return value && isCalendarDate(value) && value.startsWith(`${year}-`) ? value : undefined;
}

/** `dot` for a single-day item, `bar` for a multi-day one, `overflow` (a neutral dot) when no lane was free for any item on the day. */
export type YearMarkShape = "dot" | "bar" | "overflow";
export type YearMarkPart = "start" | "middle" | "end";

export type YearMark = {
  shape: YearMarkShape;
  /** Which of the day's two rows the mark sits in; a multi-day item keeps its lane on every day. */
  lane: 0 | 1;
  tone: CalendarTone;
  isClosure: boolean;
  /** Bars only. A one-day piece of a bar (at a month edge) is `start` when the item goes on, `end` when it came from before. */
  part?: YearMarkPart;
  /** The bar is cut here by Jan 1, Dec 31 or a month edge, and the item itself goes on past it. */
  continuesBefore?: boolean;
  continuesAfter?: boolean;
  itemKey?: string;
};

export type YearDay = {
  date: string;
  /** Day of month, 1 to 31. */
  day: number;
  /** 0 = Sunday. */
  weekday: number;
  isSabbath: boolean;
  /** Every item on the day, whether or not it has a mark. */
  count: number;
  /** At most two. */
  marks: YearMark[];
};

export type YearMonth = {
  year: number;
  /** 1 to 12. */
  month: number;
  /** `2027-03`. */
  key: string;
  /** "March 2027". */
  label: string;
  /** "March". */
  name: string;
  days: YearDay[];
  /** Sunday-first week rows for the mini grid; cells outside the month are null. */
  weeks: (YearDay | null)[][];
  /** Items overlapping the month, in date order, a repeating series once. */
  items: CalendarItem[];
};

export type CalendarYear = { year: number; months: YearMonth[] };

const dayMs = 86_400_000;
const lanes = 2;

function dateString(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function buildCalendarYear(year: number, items: CalendarItem[], toneMap: Map<string, CalendarTone>): CalendarYear {
  const first = `${year}-01-01`;
  const last = `${year}-12-31`;
  const yearStart = Date.UTC(year, 0, 1);
  const lengths = Array.from({ length: 12 }, (_, index) => new Date(Date.UTC(year, index + 1, 0)).getUTCDate());
  const dates: string[] = [];
  const monthOfIndex: number[] = [];
  lengths.forEach((length, index) => {
    for (let day = 1; day <= length; day += 1) {
      dates.push(dateString(year, index + 1, day));
      monthOfIndex.push(index);
    }
  });
  const indexOf = (date: string) => Math.round((Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) - yearStart) / dayMs);

  const inYear = items.filter((item) => item.startsOn <= item.endsOn && item.startsOn <= last && item.endsOn >= first);
  // Lanes: earliest start first, longer first, so a multi-day item takes lane 0 before a short one that starts the same day.
  const ordered = [...inYear].sort((a, b) =>
    a.startsOn.localeCompare(b.startsOn) || b.endsOn.localeCompare(a.endsOn) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
  const laneBusyUntil: string[] = Array.from({ length: lanes }, () => "");
  const buckets: { item: CalendarItem; lane: number }[][] = dates.map(() => []);
  const monthItems: CalendarItem[][] = Array.from({ length: 12 }, () => []);
  for (const item of ordered) {
    const from = item.startsOn < first ? first : item.startsOn;
    const to = item.endsOn > last ? last : item.endsOn;
    let lane = laneBusyUntil.findIndex((until) => until < from);
    if (lane >= 0) laneBusyUntil[lane] = to;
    else lane = -1;
    const startIndex = indexOf(from);
    const endIndex = indexOf(to);
    for (let index = startIndex; index <= endIndex; index += 1) buckets[index].push({ item, lane });
    for (let month = monthOfIndex[startIndex]; month <= monthOfIndex[endIndex]; month += 1) monthItems[month].push(item);
  }

  const months: YearMonth[] = lengths.map((length, monthIndex) => {
    const month = monthIndex + 1;
    const days: YearDay[] = [];
    for (let day = 1; day <= length; day += 1) {
      const date = dateString(year, month, day);
      const slots = buckets[indexOf(date)];
      const marks: YearMark[] = slots
        .filter((slot) => slot.lane >= 0)
        .sort((a, b) => a.lane - b.lane)
        .slice(0, lanes)
        .map(({ item, lane }) => {
          const tone = calendarItemTone(item, toneMap);
          const base = { lane: lane as 0 | 1, tone, isClosure: item.isClosure === true, itemKey: item.key };
          if (item.startsOn === item.endsOn) return { ...base, shape: "dot" as const };
          // Join across days inside the month only; a month edge (or Jan 1 and Dec 31) cuts the bar.
          const joinsBefore = day > 1 && item.startsOn < date;
          const joinsAfter = day < length && item.endsOn > date;
          const part: YearMarkPart = joinsBefore && joinsAfter ? "middle" : joinsBefore ? "end" : joinsAfter ? "start" : item.startsOn === date ? "start" : "end";
          return {
            ...base,
            shape: "bar" as const,
            part,
            continuesBefore: !joinsBefore && item.startsOn < date,
            continuesAfter: !joinsAfter && item.endsOn > date,
          };
        });
      // No lane was free for any item on this day: a neutral dot, so a day with items is never blank.
      if (slots.length > 0 && marks.length === 0) marks.push({ shape: "overflow", lane: 0, tone: "event", isClosure: false });
      days.push({ date, day, weekday: new Date(Date.UTC(year, monthIndex, day)).getUTCDay(), isSabbath: new Date(Date.UTC(year, monthIndex, day)).getUTCDay() === 6, count: slots.length, marks });
    }
    const weeks: (YearDay | null)[][] = [];
    let row: (YearDay | null)[] = Array.from({ length: days[0].weekday }, () => null);
    for (const day of days) {
      row.push(day);
      if (row.length === 7) {
        weeks.push(row);
        row = [];
      }
    }
    if (row.length > 0) {
      while (row.length < 7) row.push(null);
      weeks.push(row);
    }
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const label = monthLabel({ year, month });
    return { year, month, key, label, name: label.split(" ")[0], days, weeks, items: firstPerSeries(sortCalendarItems(monthItems[monthIndex])) };
  });
  return { year, months };
}
