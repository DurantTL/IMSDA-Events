/**
 * Calendar deadlines (#910), the pure half. A deadline is a calendar entry of
 * type DEADLINE: something clubs must do by a date ("Spring Camporee
 * Registration Due"). It is never on the public calendar or its feeds; clubs
 * and Area Coordinators see it as an "Upcoming deadlines" list, and staff
 * approve two reminder emails for it (14 and 2 days before).
 *
 * Everything here works on calendar dates (YYYY-MM-DD) in the conference time
 * zone, never on 24-hour multiples, so a daylight-saving change cannot move a
 * reminder a day.
 */
import { addDays, formatDateRange, isCalendarDate } from "@/modules/calendar/domain";

export type EntryTypeName = "STANDARD" | "CLOSURE" | "DEADLINE";

/** Days before the due date that a reminder batch is prepared, latest last. */
export const deadlineReminderPoints = [14, 2] as const;
export type DeadlineReminderPoint = (typeof deadlineReminderPoints)[number];

/** How far ahead the "Upcoming deadlines" list looks, and how long a passed deadline stays on it as overdue. */
export const deadlineListAheadDays = 90;
export const deadlineListOverdueDays = 7;

/**
 * The marker a staff choice of type leaves in `locallyEditedFields`. The type
 * is not a field a feed imports (so it is not in `importedFieldNames`, which
 * also feeds the change hash); this mark is only "staff chose it, a refresh
 * must not change it".
 */
export const entryTypeEditMark = "entryType";

// ---- Marking imported entries ---------------------------------------------

const dueWord = /\bdue\b/i;
const deadlineWord = /\bdeadlines?\b/i;
// "due to" gives a cause or a recipient ("Closed due to weather", "Due to Labor Day, office closed", "Reports due to the
// conference office"): too often not a deadline, so any "due to" phrase is left alone for staff to mark.
const dueTo = /\bdue\s+to\b/i;

/**
 * Whether an imported title clearly says something is due: the whole word
 * "due" ("Registration Due", "Reports are due", "Due: Points report") or
 * "deadline"/"deadlines" ("Nomination Deadline"), in any case. These do not
 * count: "overdue", "dues" (a payment, not a date), and any "due to" phrase
 * ("Closed due to weather", "Due to Labor Day, office closed", "No meetings due to
 * holiday"). "Due at", "is due" and a plain "Due" still do.
 */
export function titleSaysDue(title: string) {
  if (dueTo.test(title)) return false;
  return dueWord.test(title) || deadlineWord.test(title);
}

/**
 * The type a feed gives a new or refreshed item whose type staff have not
 * chosen. A feed whose default is Closure or Deadline keeps that default for
 * everything; otherwise an item that says it is due is a Deadline.
 */
export function autoEntryType(title: string, feedDefault: EntryTypeName): EntryTypeName {
  if (feedDefault !== "STANDARD") return feedDefault;
  return titleSaysDue(title) ? "DEADLINE" : "STANDARD";
}

/**
 * What a refresh sets an existing item's type to, or null to leave it alone.
 * Only the automatic Standard/Deadline choice moves: a Closure stays a
 * Closure, and anything staff set themselves never changes.
 */
export function refreshedEntryType(
  row: { title: string; entryType: EntryTypeName; locallyEditedFields: readonly string[] },
  freshTitle: string,
  feedDefault: EntryTypeName,
): EntryTypeName | null {
  if (row.locallyEditedFields.includes(entryTypeEditMark)) return null;
  if (row.entryType === "CLOSURE" && feedDefault === "STANDARD") return null;
  const wanted = autoEntryType(freshTitle, feedDefault);
  return wanted === row.entryType ? null : wanted;
}

// ---- Dates ----------------------------------------------------------------

function dayNumber(calendarDate: string) {
  const [year, month, day] = calendarDate.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** Whole calendar days from `today` to `dueOn`; negative once it has passed. */
export function daysUntil(dueOn: string, today: string) {
  return dayNumber(dueOn) - dayNumber(today);
}

/** "Due today", "Due tomorrow", "Due in 9 days", "1 day overdue", "3 days overdue". */
export function dueLabel(dueOn: string, today: string) {
  const days = daysUntil(dueOn, today);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days > 1) return `Due in ${days} days`;
  const late = -days;
  return `${late} ${late === 1 ? "day" : "days"} overdue`;
}

/**
 * The reminder point to prepare for a deadline today, or null. A point is
 * reached on its own date (14 or 2 days before the due date) and stays the
 * current one until the next point is reached; once the due date has passed
 * nothing is prepared. Only the latest reached point counts, so a deadline
 * added 10 days out gets one reminder (the 14-day point) and never both.
 */
export function reminderPointFor(dueOn: string, today: string): DeadlineReminderPoint | null {
  if (!isCalendarDate(dueOn) || today > dueOn) return null;
  let current: DeadlineReminderPoint | null = null;
  for (const point of deadlineReminderPoints) {
    if (addDays(dueOn, -point) <= today) current = point;
  }
  return current;
}

/** The first date a reminder point is reached, for tests and staff-facing explanations. */
export function reminderDate(dueOn: string, point: DeadlineReminderPoint) {
  return addDays(dueOn, -point);
}

// ---- The "Upcoming deadlines" list ----------------------------------------

export type DeadlineListItem = {
  key: string;
  title: string;
  dueOn: string;
  href: string | null;
  postponed: boolean;
  /** "Due in 9 days", "Due today", "2 days overdue". */
  label: string;
  overdue: boolean;
};

export function deadlineWindow(today: string) {
  return { from: addDays(today, -deadlineListOverdueDays), to: addDays(today, deadlineListAheadDays) };
}

export function toDeadlineListItem(
  row: { key: string; title: string; dueOn: string; linkUrl: string | null; status: string },
  today: string,
): DeadlineListItem {
  return {
    key: row.key,
    title: row.title,
    dueOn: row.dueOn,
    href: row.linkUrl,
    postponed: row.status === "POSTPONED",
    label: dueLabel(row.dueOn, today),
    overdue: row.dueOn < today,
  };
}

/** In date order (then title), inside the window: the next 90 days plus the last 7 as overdue. */
export function sortDeadlineItems<T extends { dueOn: string; title: string }>(items: T[]) {
  return [...items].sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title));
}

// ---- The reminder email ----------------------------------------------------

export type ReminderAudience = "CLUB" | "AREA";

const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function weekdayOf(calendarDate: string) {
  const [year, month, day] = calendarDate.split("-").map(Number);
  return weekdayNames[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

/** One line of plain text: no control characters or line breaks, so a title can never add a header or a paragraph. */
export function singleLine(value: string, max = 140) {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function inWords(days: number) {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export function buildDeadlineReminderEmail(input: {
  recipientName: string;
  title: string;
  dueOn: string;
  today: string;
  linkUrl: string | null;
  portalUrl: string;
  audience: ReminderAudience;
}) {
  const title = singleLine(input.title) || "A deadline";
  const name = singleLine(input.recipientName, 80) || "there";
  const days = daysUntil(input.dueOn, input.today);
  const date = `${weekdayOf(input.dueOn)}, ${formatDateRange(input.dueOn, input.dueOn)}`;
  const when = days <= 0 ? `is due today, ${date}` : `is due on ${date} (${inWords(days)})`;
  const where = input.audience === "AREA"
    ? "You can see every upcoming deadline for the clubs in your area, along with the clubs themselves, here:"
    : "You can see every upcoming deadline for your club in the club portal:";
  const lines = [
    `Hello ${name},`,
    "",
    `Just a friendly reminder from IMSDA Events: "${title}" ${when}.`,
    "",
  ];
  // Only an https link goes in the email, the same as the portal list.
  if (input.linkUrl && /^https:\/\//i.test(input.linkUrl)) lines.push(`More details: ${input.linkUrl}`, "");
  lines.push(
    where,
    input.portalUrl,
    "",
    input.audience === "AREA"
      ? "Thank you for walking alongside the clubs in your area."
      : "Thank you for everything you do for your club.",
    "",
    "IMSDA Events",
  );
  return {
    subject: `Deadline reminder: ${title} (${formatDateRange(input.dueOn, input.dueOn)})`,
    bodyText: lines.join("\n"),
  };
}
