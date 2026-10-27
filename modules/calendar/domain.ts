/**
 * The public conference calendar (#107). Everything here is pure: the
 * repository hands in published events and entries, and these functions lay
 * them out by calendar date in the conference's time zone.
 */

import { publicStatusLine, type PublicCapacityStatus } from "@/modules/events/public-registration-status";

export const CONFERENCE_TIME_ZONE = "America/Chicago";

export type CalendarItemStatus = "SCHEDULED" | "POSTPONED" | "CANCELLED";

export type CalendarItem = {
  /** Unique across both kinds, e.g. `event-abc` or `entry-xyz`. */
  key: string;
  kind: "EVENT" | "ENTRY";
  title: string;
  description: string;
  /** Inclusive calendar dates, YYYY-MM-DD. */
  startsOn: string;
  endsOn: string;
  timeLabel: string;
  location: string;
  category: string;
  /** Where the item links: an event page on this site, or an entry's own link. */
  href: string | null;
  status: CalendarItemStatus;
  /** Only for events: whether registration is open right now. */
  registrationOpen: boolean;
  /**
   * Only for events (#1204): the shared public status behind `registrationOpen`, the date registration opens and
   * whether the event is for clubs, so every list words the status the same way (`publicStatusLine`).
   */
  registrationStatus?: PublicCapacityStatus;
  registrationOpensOn?: string | null;
  clubEvent?: boolean;
  /** Only for events (#1217): clubs register through the club portal (club audience with an organization invoice). */
  clubPortal?: boolean;
  /** Set when several items link to one event (#1086): the event's own name, which lists use instead of an entry title. */
  eventTitle?: string;
  /** With `eventTitle`: the event's own dates, which lists use instead of the linked item's date. */
  eventStartsOn?: string;
  eventEndsOn?: string;
  /** An office closure ("Conference office closed"), shown with its own label and icon. */
  isClosure?: boolean;
  /**
   * The repeat rule of a repeating entry (#444). Set on the single master item
   * the ICS feed emits as RRULE/EXDATE; expanded occurrences on the page leave it null.
   */
  recurrence?: { rule: string; exceptions: string[] } | null;
  /** Set on every occurrence of a repeating entry, so lists can show a series once. */
  seriesId?: string;
};

/**
 * The plain-language registration status of an event item ("Registration open", "Registration opens in February"), or
 * null for anything that is not a registration-taking event. Every list words it with `publicStatusLine` (#1204).
 */
export function calendarItemStatusLine(item: CalendarItem, now = new Date()): string | null {
  if (item.kind !== "EVENT" || item.isClosure || item.status === "CANCELLED") return null;
  if (!item.registrationStatus) return item.registrationOpen ? "Registration open" : null;
  return publicStatusLine({ status: item.registrationStatus, opensOn: item.registrationOpensOn, isClubEvent: item.clubEvent }, now);
}

/** The first occurrence of each repeating entry; one-off items all stay. Items must already be in date order. */
export function firstPerSeries(items: CalendarItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.seriesId) return true;
    if (seen.has(item.seriesId)) return false;
    seen.add(item.seriesId);
    return true;
  });
}

/** How far either side of today the month view will go. */
export const calendarMonthSpanYears = 5;

/** The label and the feed category that mark an office closure. */
export const closureLabel = "Office closed";
export const closureCategory = "Office closure";

export type CalendarMonth = { year: number; month: number };

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: string) {
  if (!datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const maxCachedFormatters = 600;

/** For tests: how many formatters are cached. */
export const dateFormatterCacheSize = () => dateFormatters.size;

export function calendarDateIn(date: Date, timeZone = CONFERENCE_TIME_ZONE) {
  // Building a formatter is the slow part; one per zone serves every call.
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    if (dateFormatters.size >= maxCachedFormatters) dateFormatters.clear(); // a backstop; callers pass canonical zone names
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dateFormatters.set(timeZone, formatter);
  }
  return formatter.format(date);
}

function toDate(calendarDate: string) {
  const [year, month, day] = calendarDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(calendarDate: string, days: number) {
  const date = toDate(calendarDate);
  date.setUTCDate(date.getUTCDate() + days);
  return fromDate(date);
}

export function monthKey({ year, month }: CalendarMonth) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** `?month=2026-12`, falling back to the month containing `today`. */
export function parseMonthParam(value: string | undefined, today: string): CalendarMonth {
  const match = value?.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const todayYear = Number(today.slice(0, 4));
    if (Math.abs(year - todayYear) <= calendarMonthSpanYears && month >= 1 && month <= 12) return { year, month };
  }
  const [year, month] = today.split("-").map(Number);
  return { year, month };
}

export function shiftMonth({ year, month }: CalendarMonth, delta: number): CalendarMonth {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function firstOfMonth(month: CalendarMonth) {
  return `${monthKey(month)}-01`;
}

export function lastOfMonth(month: CalendarMonth) {
  return addDays(firstOfMonth(shiftMonth(month, 1)), -1);
}

/** Whole weeks, Sunday first, covering the month. Days outside it are included to fill the grid. */
export function monthGrid(month: CalendarMonth) {
  const first = firstOfMonth(month);
  const last = lastOfMonth(month);
  let cursor = addDays(first, -toDate(first).getUTCDay());
  const end = addDays(last, 6 - toDate(last).getUTCDay());
  const weeks: string[][] = [];
  while (cursor <= end) {
    const week: string[] = [];
    for (let day = 0; day < 7; day += 1) {
      week.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function compareCalendarItems(a: CalendarItem, b: CalendarItem) {
  return a.startsOn.localeCompare(b.startsOn) || a.endsOn.localeCompare(b.endsOn) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
}

export function sortCalendarItems(items: CalendarItem[]) {
  return [...items].sort(compareCalendarItems);
}

export function itemsOnDate(items: CalendarItem[], date: string) {
  return items.filter((item) => item.startsOn <= date && item.endsOn >= date);
}

const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Monday, March 2, 2026": the full date a screen reader hears for a day. */
export function formatWeekdayDate(date: string) {
  return `${weekdayNames[toDate(date).getUTCDay()]}, ${formatLongDate(date)}`;
}

/** The number of distinct category tones (#1202); each has its own fill, edge and text colour in the stylesheet. */
export const calendarToneCount = 6;

export type CalendarTone = "event" | "closure" | 1 | 2 | 3 | 4 | 5 | 6;

const categoryKey = (category: string) => category.trim().toLowerCase();

/**
 * One tone per category by position, so up to six categories never share a colour. Pass the items before the category filter, so a
 * filter click changes no colour. Only categories with at least one entry (not an event, not a closure) take a tone slot: events are
 * always navy and closures always striped, so a category only they use shows that look in the key and takes no slot.
 */
export function calendarToneMap(items: Pick<CalendarItem, "kind" | "isClosure" | "category">[]) {
  const map = new Map<string, CalendarTone>();
  let slots = 0;
  for (const name of calendarCategories(items as CalendarItem[])) {
    const key = categoryKey(name);
    if (map.has(key) || key === closureCategory.toLowerCase()) continue;
    const inCategory = items.filter((item) => categoryKey(item.category) === key);
    if (inCategory.some((item) => item.kind === "ENTRY" && !item.isClosure)) {
      map.set(key, ((slots % calendarToneCount) + 1) as CalendarTone);
      slots += 1;
    } else {
      map.set(key, inCategory.some((item) => !item.isClosure) ? "event" : "closure");
    }
  }
  return map;
}

/** One colour rule for the grid bars, the phone dots, the day panel and the key: closures striped, IMSDA events navy, else the category's tone. */
export function calendarItemTone(item: Pick<CalendarItem, "kind" | "isClosure" | "category">, toneMap: Map<string, CalendarTone>): CalendarTone {
  if (item.isClosure) return "closure";
  if (item.kind === "EVENT") return "event";
  const tone = toneMap.get(categoryKey(item.category));
  return typeof tone === "number" ? tone : 1;
}

/** The tone a category's filter button and key swatch show: the closure category is striped, any other the category's own tone. */
export function calendarKeyTone(category: string, toneMap: Map<string, CalendarTone>): CalendarTone {
  return categoryKey(category) === closureCategory.toLowerCase() ? "closure" : (toneMap.get(categoryKey(category)) ?? 1);
}

/** Rows of bars a month-grid week shows under the date (#1249); anything further is counted as "+N more". */
export const calendarGridRows = 2;

/** "+3 more": what a crowded day shows after its bars. */
export function calendarMoreLabel(hidden: number) {
  return `+${hidden} more`;
}

export type WeekBar = {
  item: CalendarItem;
  /** 1 to 7, the grid column the bar starts in. */
  startCol: number;
  /** Columns covered inside this week. */
  span: number;
  /** 0-based row, below the date row. */
  row: number;
  /** The item started before this week: square left edge and a ‹. */
  continuesBefore: boolean;
  /** The item runs past this week: square right edge and a ›. */
  continuesAfter: boolean;
  /** The first and last dates the bar covers inside this week. */
  segmentStart: string;
  segmentEnd: string;
};

/**
 * Lays one week's items out as bars (#1202): longest segment first, then earliest, then the calendar's own order. Each bar takes the
 * first row free across all its columns; an item that fits in no row below `maxRows` is hidden and counted once on each day it covers.
 */
export function weekBarLayout(week: string[], items: CalendarItem[], maxRows = 4) {
  const first = week[0];
  const last = week[week.length - 1];
  const segments = items
    .filter((item) => item.startsOn <= last && item.endsOn >= first)
    .map((item) => {
      const segmentStart = item.startsOn < first ? first : item.startsOn;
      const segmentEnd = item.endsOn > last ? last : item.endsOn;
      const startCol = week.indexOf(segmentStart) + 1;
      const endCol = week.indexOf(segmentEnd) + 1;
      return { item, segmentStart, segmentEnd, startCol, span: endCol - startCol + 1 };
    })
    .sort((a, b) => b.span - a.span || a.startCol - b.startCol || compareCalendarItems(a.item, b.item));
  const occupied: boolean[][] = Array.from({ length: maxRows }, () => Array(week.length).fill(false));
  const bars: WeekBar[] = [];
  const hiddenByDay: number[] = Array(week.length).fill(0);
  for (const segment of segments) {
    const from = segment.startCol - 1;
    const to = from + segment.span;
    const row = occupied.findIndex((cells) => cells.slice(from, to).every((taken) => !taken));
    if (row === -1) {
      for (let column = from; column < to; column += 1) hiddenByDay[column] += 1;
      continue;
    }
    for (let column = from; column < to; column += 1) occupied[row][column] = true;
    bars.push({
      item: segment.item,
      startCol: segment.startCol,
      span: segment.span,
      row,
      continuesBefore: segment.item.startsOn < first,
      continuesAfter: segment.item.endsOn > last,
      segmentStart: segment.segmentStart,
      segmentEnd: segment.segmentEnd,
    });
  }
  return { bars, hiddenByDay };
}

/** The `date` query value: a real calendar date within the month span, else undefined (the day detail is simply not shown). */
export function parseDateParam(value: string | undefined, today: string): string | undefined {
  if (!value || !isCalendarDate(value)) return undefined;
  const month = parseMonthParam(value.slice(0, 7), today);
  return monthKey(month) === value.slice(0, 7) ? value : undefined;
}

/** The month shown and the selected date: a valid date (month view only) wins over the month param and decides the month. */
export function resolveMonthAndDate(view: "month" | "list", monthParam: string | undefined, dateParam: string | undefined, today: string) {
  const selectedDate = view === "month" ? parseDateParam(dateParam, today) : undefined;
  return { selectedDate, month: parseMonthParam(selectedDate ? selectedDate.slice(0, 7) : monthParam, today) };
}

/** "April 24, 2027". */
export function formatLongDate(date: string) {
  return formatDateRange(date, date);
}

/** "1 event", "5 events": the count is always words, never colour. */
export function calendarCountLabel(count: number) {
  return `${count} ${count === 1 ? "event" : "events"}`;
}

export function itemsOverlapping(items: CalendarItem[], from: string, to: string) {
  return sortCalendarItems(items.filter((item) => item.startsOn <= to && item.endsOn >= from));
}

export function calendarCategories(items: CalendarItem[]) {
  return [...new Set(items.map((item) => item.category.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

export function filterByCategory(items: CalendarItem[], category: string | undefined) {
  if (!category) return items;
  const wanted = category.toLowerCase();
  return items.filter((item) => item.category.toLowerCase() === wanted);
}

const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthLabel({ year, month }: CalendarMonth) {
  return `${monthNames[month - 1]} ${year}`;
}

/** "December 5, 2026", "December 5–7, 2026", "Dec 30, 2026 – Jan 2, 2027". */
export function formatDateRange(startsOn: string, endsOn: string) {
  const [startYear, startMonth, startDay] = startsOn.split("-").map(Number);
  const [endYear, endMonth, endDay] = endsOn.split("-").map(Number);
  if (startsOn === endsOn) return `${monthNames[startMonth - 1]} ${startDay}, ${startYear}`;
  if (startYear === endYear && startMonth === endMonth) {
    return `${monthNames[startMonth - 1]} ${startDay}–${endDay}, ${startYear}`;
  }
  if (startYear === endYear) {
    return `${monthNames[startMonth - 1]} ${startDay} – ${monthNames[endMonth - 1]} ${endDay}, ${startYear}`;
  }
  return `${monthNames[startMonth - 1].slice(0, 3)} ${startDay}, ${startYear} – ${monthNames[endMonth - 1].slice(0, 3)} ${endDay}, ${endYear}`;
}

/** A one-day event's hours in its own time zone ("9:00 AM – 5:00 PM CST"); multi-day events show dates only. */
export function eventTimeLabel(startsAt: Date, endsAt: Date, timeZone: string) {
  if (calendarDateIn(startsAt, timeZone) !== calendarDateIn(endsAt, timeZone)) return "";
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  const zone = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(startsAt).find((part) => part.type === "timeZoneName")?.value ?? "";
  return `${time.format(startsAt)} – ${time.format(endsAt)}${zone ? ` ${zone}` : ""}`;
}

export const calendarStatusLabels: Record<CalendarItemStatus, string> = {
  SCHEDULED: "Scheduled",
  POSTPONED: "Postponed",
  CANCELLED: "Cancelled",
};

function escapeIcsText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
}

/** RFC 5545 folds content lines longer than 75 octets. */
function foldIcsLine(line: string) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const character of line) {
    const width = encoder.encode(character).length;
    if (size + width > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += character;
    size += width;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function icsStamp(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** A subscribable iCalendar feed of all-day items. */
export function buildCalendarIcs(items: CalendarItem[], options: { baseUrl: string; now: Date }) {
  const base = options.baseUrl.replace(/\/$/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//IMSDA//Events calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:IMSDA conference calendar",
    `X-WR-TIMEZONE:${CONFERENCE_TIME_ZONE}`,
  ];
  for (const item of sortCalendarItems(items)) {
    const url = item.href ? (item.href.startsWith("/") ? `${base}${item.href}` : item.href) : null;
    const details = [item.timeLabel, item.description].filter(Boolean).join("\n\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${item.key}@imsda-events`,
      `DTSTAMP:${icsStamp(options.now)}`,
      `DTSTART;VALUE=DATE:${item.startsOn.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${addDays(item.endsOn, 1).replace(/-/g, "")}`,
      `SUMMARY:${escapeIcsText(item.status === "POSTPONED" ? `Postponed: ${item.title}` : item.title)}`,
      `STATUS:${item.status === "CANCELLED" ? "CANCELLED" : item.status === "POSTPONED" ? "TENTATIVE" : "CONFIRMED"}`,
    );
    if (item.location) lines.push(`LOCATION:${escapeIcsText(item.location)}`);
    if (details) lines.push(`DESCRIPTION:${escapeIcsText(details)}`);
    const categories = [item.isClosure ? closureCategory : "", item.category].filter(Boolean);
    if (categories.length > 0) lines.push(`CATEGORIES:${categories.map(escapeIcsText).join(",")}`);
    if (item.recurrence) {
      lines.push(`RRULE:${item.recurrence.rule}`);
      const exceptions = [...item.recurrence.exceptions].sort().map((date) => date.replace(/-/g, ""));
      if (exceptions.length > 0) lines.push(`EXDATE;VALUE=DATE:${exceptions.join(",")}`);
    }
    if (url) lines.push(`URL:${url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}
