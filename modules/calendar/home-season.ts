/**
 * The public homepage's season view (#1251), all pure: the closing-soon box, the six-month ribbon with its lanes, the
 * three-month list for phones, and each ministry tile's next item. The page hands in calendar items and a clock.
 */

import {
  CONFERENCE_TIME_ZONE,
  addDays,
  firstPerSeries,
  formatLongDate,
  shiftMonth,
  sortCalendarItems,
  type CalendarItem,
} from "@/modules/calendar/domain";
import { daysUntilRegistrationCloses, registrationClosesLine } from "@/modules/events/public-registration-status";
import { ministryLinkHref, type HomepageMinistry } from "@/modules/system-admin/homepage-ministries-domain";

const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const shortMonthNames = monthNames.map((name) => name.slice(0, 3));

const dayNumber = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
};
const daysBetween = (from: string, to: string) => Math.round(dayNumber(to) - dayNumber(from));

/** Cancelled items and closures are never "the next event": a closure is not something to attend. */
const isAttendable = (item: CalendarItem) => !item.isClosure && item.status !== "CANCELLED";

// ---- Closing soon ----

export type ClosingSoon = { item: CalendarItem; days: number; closesOn: string; line: string };

/**
 * The closing flag for one item: only an event whose registration can be joined now (open, or a waitlist) and whose last
 * day is today or within 14 days. Days are counted in the event's own time zone (#1209).
 */
export function closingSoonFor(item: CalendarItem, now = new Date()): ClosingSoon | null {
  if (item.kind !== "EVENT" || !isAttendable(item) || !item.registrationClosesOn) return null;
  const joinable = item.registrationStatus ? item.registrationStatus === "OPEN" || item.registrationStatus === "WAITLIST" : item.registrationOpen;
  if (!joinable) return null;
  const days = daysUntilRegistrationCloses(item.registrationClosesOn, item.registrationTimeZone ?? CONFERENCE_TIME_ZONE, now);
  if (days === null) return null;
  return { item, days, closesOn: item.registrationClosesOn, line: registrationClosesLine(days, formatLongDate(item.registrationClosesOn)) };
}

/** The event that closes soonest (ties: the one that starts first), or null when none closes within 14 days. */
export function nextClosingSoon(items: CalendarItem[], now = new Date()): ClosingSoon | null {
  let best: ClosingSoon | null = null;
  for (const item of items) {
    const flag = closingSoonFor(item, now);
    if (!flag) continue;
    if (!best || flag.days < best.days || (flag.days === best.days && item.startsOn < best.item.startsOn)) best = flag;
  }
  return best;
}

// ---- Lanes ----

export type SeasonLane = "clubs" | "ministries" | "closed";

export const seasonLanes: { lane: SeasonLane; label: string }[] = [
  { lane: "clubs", label: "Clubs" },
  { lane: "ministries", label: "Ministries & camps" },
  { lane: "closed", label: "Office closed" },
];

const clubCategories = ["pathfinders", "adventurers"];

/** Closures first, then club events (the event's audience, or a Pathfinders or Adventurers category), then everything else. */
export function laneFor(item: CalendarItem): SeasonLane {
  if (item.isClosure) return "closed";
  if (item.clubEvent || clubCategories.includes(item.category.trim().toLowerCase())) return "clubs";
  return "ministries";
}

// ---- Dates ----

/** "Oct 3", "Oct 3–5", "Oct 30 – Nov 2". No year: the ribbon and the list only reach six months ahead, and the long form is in each link's label. */
export function shortDateRange(startsOn: string, endsOn: string) {
  const [, startMonth, startDay] = startsOn.split("-").map(Number);
  const [, endMonth, endDay] = endsOn.split("-").map(Number);
  const start = `${shortMonthNames[startMonth - 1]} ${startDay}`;
  if (startsOn === endsOn) return start;
  if (startMonth === endMonth && startsOn.slice(0, 4) === endsOn.slice(0, 4)) return `${start}–${endDay}`;
  return `${start} – ${shortMonthNames[endMonth - 1]} ${endDay}`;
}

/** The first of the month `delta` months after the month containing `date`. */
function firstOfMonthAfter(date: string, delta: number) {
  const [year, month] = date.split("-").map(Number);
  const shifted = shiftMonth({ year, month }, delta);
  return `${shifted.year}-${String(shifted.month).padStart(2, "0")}-01`;
}

// ---- The six-month ribbon ----

export type SeasonWindow = { start: string; end: string; totalDays: number };

/** Today through the day before the same day six months on (the first of the month when that day does not exist). */
export function seasonWindow(today: string): SeasonWindow {
  const [, , day] = today.split("-").map(Number);
  const target = firstOfMonthAfter(today, 6);
  const lastOfTarget = addDays(firstOfMonthAfter(target, 1), -1);
  const sameDay = `${target.slice(0, 8)}${String(Math.min(day, Number(lastOfTarget.slice(8)))).padStart(2, "0")}`;
  const end = addDays(sameDay, -1);
  return { start: today, end, totalDays: daysBetween(today, end) + 1 };
}

/** Where each month starts along the ribbon, as a percentage, for the labels and grid lines. The first label sits at 0. */
export function seasonMonthMarks(window: SeasonWindow) {
  const marks: { label: string; leftPct: number }[] = [];
  const [startYear, startMonth] = window.start.split("-").map(Number);
  marks.push({ label: monthNames[startMonth - 1], leftPct: 0 });
  for (let step = 1; step <= 6; step += 1) {
    const first = firstOfMonthAfter(window.start, step);
    if (first > window.end) break;
    const [year, month] = first.split("-").map(Number);
    marks.push({ label: year === startYear ? monthNames[month - 1] : `${monthNames[month - 1]} ${year}`, leftPct: round((daysBetween(window.start, first) / window.totalDays) * 100) });
  }
  // A month with only a few days left would put its label on top of the next one's.
  if (marks.length > 1 && marks[1].leftPct < 8) marks.shift();
  return marks;
}

const round = (value: number) => Math.round(value * 100) / 100;

export type SeasonEntry = {
  item: CalendarItem;
  /** A single day is a dot; anything longer is a bar. */
  mark: "dot" | "bar";
  dateLabel: string;
  /** "Name, Oct 3–5": what a link announces and a tooltip shows. */
  accessibleLabel: string;
  /** The box the entry takes, as percentages of the ribbon: `anchor` says which edge it hangs from. */
  anchor: "left" | "right";
  edgePct: number;
  extentPct: number;
  /** The bar's share of that box, as a percentage. */
  markPct: number;
  /** 0-based row inside the lane, so entries that would overlap stack instead. */
  row: number;
};

export type SeasonLaneLayout = { lane: SeasonLane; label: string; rows: number; entries: SeasonEntry[] };

/** About how much of the ribbon a character of label text takes; a guess that keeps neighbours from running together. */
const labelPctPerChar = 0.7;
const rowGapPct = 0.6;

function entryFor(item: CalendarItem, window: SeasonWindow): Omit<SeasonEntry, "row"> & { from: number; to: number } {
  const startsOn = item.startsOn < window.start ? window.start : item.startsOn;
  const endsOn = item.endsOn > window.end ? window.end : item.endsOn;
  const startPct = (daysBetween(window.start, startsOn) / window.totalDays) * 100;
  const endPct = ((daysBetween(window.start, endsOn) + 1) / window.totalDays) * 100;
  const mark = item.startsOn === item.endsOn ? "dot" : "bar";
  const dateLabel = shortDateRange(item.startsOn, item.endsOn);
  const title = item.eventTitle ?? item.title;
  const barPct = Math.max(endPct - startPct, 100 / window.totalDays);
  const labelPct = Math.min((title.length + dateLabel.length + 3) * labelPctPerChar + 2, 100);
  const extent = Math.max(barPct, labelPct);
  // Near the right edge the label would run off the ribbon, so the box hangs from the right instead.
  const anchor = startPct + extent > 100 ? "right" : "left";
  const from = anchor === "left" ? startPct : Math.max(0, startPct + barPct - extent);
  const to = from + extent;
  return {
    item,
    mark,
    dateLabel,
    accessibleLabel: `${title}, ${formatDateText(item)}`,
    anchor,
    edgePct: anchor === "left" ? round(from) : round(100 - (startPct + barPct)),
    extentPct: round(extent),
    markPct: round((barPct / extent) * 100),
    from,
    to,
  };
}

function formatDateText(item: CalendarItem) {
  return item.startsOn === item.endsOn ? formatLongDate(item.startsOn) : `${formatLongDate(item.startsOn)} to ${formatLongDate(item.endsOn)}`;
}

/** The items the ribbon and the month list draw: in the window, one per repeating series, none cancelled. */
export function seasonItems(items: CalendarItem[], from: string, to: string) {
  return firstPerSeries(sortCalendarItems(items)).filter((item) => item.status !== "CANCELLED" && item.startsOn <= to && item.endsOn >= from);
}

/** The ribbon: one lane each for clubs, ministries and camps, and office closures, every entry placed by date. */
export function seasonRibbon(items: CalendarItem[], window: SeasonWindow): { lanes: SeasonLaneLayout[]; marks: { label: string; leftPct: number }[] } {
  const visible = seasonItems(items, window.start, window.end);
  const lanes = seasonLanes.map(({ lane, label }) => {
    const rowEnds: { from: number; to: number }[][] = [];
    const entries = visible.filter((item) => laneFor(item) === lane).map((item): SeasonEntry => {
      const { from, to, ...entry } = entryFor(item, window);
      let row = rowEnds.findIndex((placed) => placed.every((box) => to + rowGapPct <= box.from || from >= box.to + rowGapPct));
      if (row === -1) {
        row = rowEnds.length;
        rowEnds.push([]);
      }
      rowEnds[row].push({ from, to });
      return { ...entry, row };
    });
    return { lane, label, rows: Math.max(1, rowEnds.length), entries };
  });
  return { lanes, marks: seasonMonthMarks(window) };
}

// ---- The three-month list (phones) ----

export type SeasonMonth = { key: string; label: string; entries: { item: CalendarItem; dateLabel: string; isClosure: boolean }[] };

/** The current month and the two after it, each with the items that start in it (an item already under way is under this month). */
export function nextMonthsList(items: CalendarItem[], today: string, months = 3): SeasonMonth[] {
  const lastDay = addDays(firstOfMonthAfter(today, months), -1);
  const visible = seasonItems(items, today, lastDay);
  return Array.from({ length: months }, (_, step) => {
    const first = step === 0 ? today : firstOfMonthAfter(today, step);
    const last = addDays(firstOfMonthAfter(today, step + 1), -1);
    const [year, month] = first.split("-").map(Number);
    const key = first.slice(0, 7);
    return {
      key,
      label: `${monthNames[month - 1]} ${year}`,
      entries: visible
        .filter((item) => (step === 0 ? item.startsOn <= last : item.startsOn >= first && item.startsOn <= last))
        .map((item) => ({ item, dateLabel: shortDateRange(item.startsOn, item.endsOn), isClosure: Boolean(item.isClosure) })),
    };
  });
}

// ---- Ministry tiles ----

export type MinistryTile = {
  position: number;
  name: string;
  description: string | null;
  icon: HomepageMinistry["icon"];
  href: string;
  next: { title: string; dateLabel: string } | null;
  closing: ClosingSoon | null;
};

/** The first upcoming, attendable item whose category is one of the tile's (any case); null when there is none. */
export function nextItemForCategories(items: CalendarItem[], categories: string[], today: string): CalendarItem | null {
  const wanted = new Set(categories.map((category) => category.trim().toLowerCase()).filter(Boolean));
  if (wanted.size === 0) return null;
  return sortCalendarItems(items).find((item) => isAttendable(item) && item.endsOn >= today && wanted.has(item.category.trim().toLowerCase())) ?? null;
}

export function ministryTiles(ministries: HomepageMinistry[], items: CalendarItem[], today: string, now = new Date()): MinistryTile[] {
  return [...ministries].sort((a, b) => a.position - b.position).map((ministry) => {
    const next = nextItemForCategories(items, ministry.categories, today);
    return {
      position: ministry.position,
      name: ministry.name,
      description: ministry.description,
      icon: ministry.icon,
      href: ministryLinkHref(ministry),
      next: next ? { title: next.eventTitle ?? next.title, dateLabel: shortDateRange(next.startsOn, next.endsOn) } : null,
      closing: next ? closingSoonFor(next, now) : null,
    };
  });
}

// ---- Help contact ----

/** The footer's help links: a `tel:` link from the phone's digits, a `mailto:` link from the email; null when both are blank. */
export function helpContactLinks({ phone, email }: { phone: string | null; email: string | null }) {
  const phoneText = phone?.trim() ?? "";
  const emailText = email?.trim() ?? "";
  if (!phoneText && !emailText) return null;
  return {
    phone: phoneText ? { text: phoneText, href: `tel:${phoneText.replace(/[^\d+]/g, "")}` } : null,
    email: emailText ? { text: emailText, href: `mailto:${emailText}` } : null,
  };
}
