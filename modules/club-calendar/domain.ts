/**
 * The optional club calendar (#1700), pure. A club's director and deputy add meetings, outings and deadlines; every
 * active club role can see them next to the conference's published calendar. Reminders are off until the director or
 * deputy turns them on, and go to the club's active role holders, at most once for an item on a date.
 *
 * Dates are calendar dates (YYYY-MM-DD) and times are local conference time (`CONFERENCE_TIME_ZONE`), as text, so no
 * time zone arithmetic can move an item to another day.
 */

import { CONFERENCE_TIME_ZONE } from "@/modules/calendar/conference-format";
import { addDays, calendarDateIn, isCalendarDate, type CalendarItem } from "@/modules/calendar/domain";
import type { ClubCapabilities } from "@/modules/organizations/director-grants-domain";

export const CLUB_CALENDAR_FEATURE_KEY = "club-calendar";
export const CLUB_CALENDAR_PATH = "calendar";

export const CLUB_CALENDAR_KINDS = ["MEETING", "OUTING", "DEADLINE"] as const;
export type ClubCalendarKind = (typeof CLUB_CALENDAR_KINDS)[number];

export const clubCalendarKindLabels: Record<ClubCalendarKind, string> = {
  MEETING: "Meeting",
  OUTING: "Outing",
  DEADLINE: "Deadline",
};

export const CLUB_CALENDAR_TITLE_MAX = 80;
export const CLUB_CALENDAR_LOCATION_MAX = 120;
export const CLUB_CALENDAR_NOTES_MAX = 1000;

export const REMINDER_DAYS_MIN = 1;
export const REMINDER_DAYS_MAX = 14;
export const REMINDER_DAYS_DEFAULT = 2;
/** Reminders go out from this conference-local hour, so nobody is emailed in the middle of the night. */
export const REMINDER_START_HOUR = 8;
/** The most reminders one sweep queues, so a first run after a long gap cannot flood the outbox. */
export const REMINDER_RUN_CAP = 100;

/** Who adds, edits and deletes items and changes the reminder setting: the director and deputy (the club-profile capability). */
export function canManageClubCalendar(capabilities: Pick<ClubCapabilities, "editProfile">): boolean {
  return capabilities.editProfile;
}

export function isClubCalendarKind(value: unknown): value is ClubCalendarKind {
  return typeof value === "string" && (CLUB_CALENDAR_KINDS as readonly string[]).includes(value);
}

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isClubCalendarTime(value: string) {
  return timePattern.test(value);
}

export function isClubCalendarDate(value: string) {
  return isCalendarDate(value);
}

/** A plain sentence for a start and end that do not fit together, or null. */
export function timeRangeProblem(startTime: string | null, endTime: string | null): string | null {
  if (endTime && !startTime) return "Enter a start time before an end time.";
  if (startTime && endTime && endTime <= startTime) return "The end time must be after the start time.";
  return null;
}

export function isValidReminderDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= REMINDER_DAYS_MIN && value <= REMINDER_DAYS_MAX;
}

/** "9:30 AM" from "09:30". */
export function timeLabel(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const suffix = hour! >= 12 ? "PM" : "AM";
  const twelve = hour! % 12 === 0 ? 12 : hour! % 12;
  return `${twelve}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function timeRangeLabel(startTime: string | null, endTime: string | null) {
  if (!startTime) return "";
  return endTime ? `${timeLabel(startTime)} to ${timeLabel(endTime)}` : timeLabel(startTime);
}

// --- Reminders ---------------------------------------------------------------------------------------------------

/** The conference-local hour (0 to 23) of an instant. */
export function conferenceHour(now: Date): number {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: CONFERENCE_TIME_ZONE, hour: "numeric", hourCycle: "h23" }).format(now);
  return Number(hour) % 24;
}

export function conferenceToday(now: Date) {
  return calendarDateIn(now, CONFERENCE_TIME_ZONE);
}

/**
 * Whether an item's reminder is due: today's conference date is within `daysBefore` days before the item's date, up to
 * and including the day itself, and it is 8 a.m. or later in conference time. An item in the past is never due.
 */
export function reminderIsDue(itemDate: string, daysBefore: number, now: Date): boolean {
  if (!isCalendarDate(itemDate) || !isValidReminderDays(daysBefore)) return false;
  if (conferenceHour(now) < REMINDER_START_HOUR) return false;
  const today = conferenceToday(now);
  return today <= itemDate && addDays(itemDate, -daysBefore) <= today;
}

/** The earliest and latest item dates that can be due on this conference date, for the database read. */
export function reminderDateBounds(now: Date) {
  const today = conferenceToday(now);
  return { from: today, to: addDays(today, REMINDER_DAYS_MAX) };
}

/** One outbox key per item, item date and address, so a moved item (a new date) is a new key and a repeat is the same key. */
export function calendarReminderIdempotencyKey(itemId: string, itemDate: string, email: string) {
  return `club-calendar-reminder:${itemId}:${itemDate}:${email.trim().toLowerCase()}`;
}

export function calendarPageUrl(baseUrl: string, organizationId: string, itemDate?: string) {
  const url = new URL(`/account/clubs/${encodeURIComponent(organizationId)}/${CLUB_CALENDAR_PATH}`, baseUrl);
  if (itemDate) url.searchParams.set("month", itemDate.slice(0, 7));
  return url.toString();
}

export type ReminderItem = {
  id: string;
  kind: ClubCalendarKind;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
};

const longDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", year: "numeric", month: "long", day: "numeric" });

/**
 * The email for one item: the club, the kind, the title, the date, the time, the place and a link to the calendar page.
 * The item's notes are never part of it, and nothing about a person but the greeting name.
 */
export function calendarReminderEmail(input: { recipientName: string; clubName: string; item: ReminderItem; calendarUrl: string }) {
  const { item } = input;
  const kind = clubCalendarKindLabels[item.kind];
  const greeting = input.recipientName.trim() ? `Hello ${input.recipientName.trim()},` : "Hello,";
  const lines = [
    greeting,
    "",
    `A ${kind.toLowerCase()} is coming up on the ${input.clubName} calendar.`,
    "",
    `${kind}: ${item.title}`,
    `Date: ${longDate(item.date)}`,
  ];
  const when = timeRangeLabel(item.startTime, item.endTime);
  if (when) lines.push(`Time: ${when} (Central time)`);
  if (item.location) lines.push(`Where: ${item.location}`);
  lines.push("", `Open the club calendar: ${input.calendarUrl}`, "", "A club director or deputy can turn these reminders off on the calendar page.");
  return { subject: `${input.clubName}: ${kind} on ${longDate(item.date)}: ${item.title}`, bodyText: lines.join("\n") };
}

// --- The month agenda --------------------------------------------------------------------------------------------

export type AgendaEntry = {
  key: string;
  source: "CLUB" | "CONFERENCE";
  /** The text label shown beside the colour: "Club meeting", "Conference event", and so on. */
  label: string;
  title: string;
  /** The first day of this entry inside the month, and the last. */
  startsOn: string;
  endsOn: string;
  timeLabel: string;
  location: string;
  /** Club items only: the raw HH:MM times, for the editor. */
  startTime?: string | null;
  endTime?: string | null;
  /** Club items only: the id to edit or delete. */
  itemId?: string;
  kind?: ClubCalendarKind;
  notes?: string | null;
  href?: string | null;
};

export type ClubItemRow = ReminderItem & { notes: string | null };

export function conferenceLabel(item: Pick<CalendarItem, "kind" | "isClosure">) {
  if (item.isClosure) return "Conference office closed";
  return item.kind === "EVENT" ? "Conference event" : "Conference calendar";
}

/**
 * The club's own items in the month together with the conference's items that overlap it, in date and time order, each
 * with a text label that says whose it is (colour is only a second cue).
 */
export function buildAgenda(input: { clubItems: readonly ClubItemRow[]; conferenceItems: readonly CalendarItem[]; from: string; to: string }): AgendaEntry[] {
  const entries: AgendaEntry[] = [];
  for (const item of input.clubItems) {
    if (item.date < input.from || item.date > input.to) continue;
    entries.push({
      key: `club-${item.id}`,
      source: "CLUB",
      label: `Club ${clubCalendarKindLabels[item.kind].toLowerCase()}`,
      title: item.title,
      startsOn: item.date,
      endsOn: item.date,
      timeLabel: timeRangeLabel(item.startTime, item.endTime),
      location: item.location ?? "",
      startTime: item.startTime,
      endTime: item.endTime,
      itemId: item.id,
      kind: item.kind,
      notes: item.notes,
    });
  }
  for (const item of input.conferenceItems) {
    if (item.endsOn < input.from || item.startsOn > input.to) continue;
    entries.push({
      key: `conference-${item.key}`,
      source: "CONFERENCE",
      label: conferenceLabel(item),
      title: item.eventTitle ?? item.title,
      startsOn: item.startsOn < input.from ? input.from : item.startsOn,
      endsOn: item.endsOn > input.to ? input.to : item.endsOn,
      timeLabel: item.timeLabel,
      location: item.location,
      href: item.href,
    });
  }
  const sortTime = (entry: AgendaEntry) => (entry.source === "CLUB" ? timeKey(entry.timeLabel) : "");
  return entries.sort((a, b) => a.startsOn.localeCompare(b.startsOn) || sortTime(a).localeCompare(sortTime(b)) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}

/** A sortable key from a label like "9:30 AM to ...": entries without a time come first within their day. */
function timeKey(label: string) {
  const match = label.match(/^(\d{1,2}):(\d{2}) (AM|PM)/);
  if (!match) return "";
  const hour = (Number(match[1]) % 12) + (match[3] === "PM" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}
