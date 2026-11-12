import { isEmail } from "@/lib/field-validation";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { reportMonthLabel, monthNotDueForClub } from "@/modules/club-reports/domain";

/**
 * The automatic Monthly Record reminder (#1895): the pure rules. When it is due, which clubs and people it goes to, and
 * exactly what each email says. No database, no clock and no secrets here, so what the sweep decides and what the
 * tests pin are the very same functions.
 *
 * Caleb decided on November 11, 2026 that this one reminder is sent automatically (no staff Send), on the 11th of each
 * month, to the director and deputy of each active club whose previous month's record is not submitted. The email names
 * the club and the month and links to the club's Monthly Record page. It never carries a child's or a Pathfinder's name.
 */

/** The reminder is due from this day of the month, in conference time. The record itself is due on the 10th. */
export const MONTHLY_RECORD_REMINDER_DAY = 11;

export type ReminderWindow = {
  /** The conference calendar date, "YYYY-MM-DD". */
  today: string;
  /** The record month the reminder is about: the month before today's, "YYYY-MM". */
  reportMonth: string;
  /** The club year whose on/off switch governs this run (the club year of today's date). */
  switchClubYear: string;
  /** The club year the record month belongs to. */
  reportClubYear: string;
};

function previousMonth(month: string) {
  const [year, number] = month.split("-").map(Number);
  return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, "0")}`;
}

function clubYearOfMonth(month: string) {
  return clubYearFor(new Date(`${month}-15T12:00:00Z`));
}

/**
 * Whether the reminder is due on this conference date, and for which month. It is due from the 11th to the end of the
 * month, and only ever for the month before: a sweep that first runs on the 12th still sends it, and nothing is sent
 * on the 1st to 10th, so an older month is never caught up late. `today` is "YYYY-MM-DD" in conference time.
 */
export function reminderWindow(today: string): ReminderWindow | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  if (Number(today.slice(8, 10)) < MONTHLY_RECORD_REMINDER_DAY) return null;
  const reportMonth = previousMonth(today.slice(0, 7));
  return { today, reportMonth, switchClubYear: clubYearOfMonth(today.slice(0, 7)), reportClubYear: clubYearOfMonth(reportMonth) };
}

export type ReminderClub = {
  id: string;
  name: string;
  /** The calendar day a club created through a new-club application joined, else null (#1410). */
  joinedOn: string | null;
  /** The status of its record for the month: null when there is none. */
  status: "DRAFT" | "SUBMITTED" | null;
};

/** Only a SUBMITTED record counts as filed. A missing record and a draft (which includes a record the club reopened) do not. */
export function recordIsSubmitted(status: ReminderClub["status"]) {
  return status === "SUBMITTED";
}

/** A club owes the month when it is active (the caller passes active clubs), had joined, and has not submitted it. */
export function clubOwesRecord(club: ReminderClub, reportMonth: string) {
  if (recordIsSubmitted(club.status)) return false;
  return !monthNotDueForClub(reportMonth, club.joinedOn, club.status !== null);
}

export type ReminderGrant = {
  role: "DIRECTOR" | "DEPUTY" | "REGISTRAR" | "REPORTER";
  email: string | null | undefined;
  name: string;
};

export type ReminderRecipient = { email: string; name: string };

/** Directors and deputies only, with a usable address, one message per address (compared in lower case). */
export function reminderRecipients(grants: readonly ReminderGrant[]): ReminderRecipient[] {
  const seen = new Set<string>();
  const people: ReminderRecipient[] = [];
  for (const grant of grants) {
    if (grant.role !== "DIRECTOR" && grant.role !== "DEPUTY") continue;
    const email = (grant.email ?? "").trim().toLowerCase();
    if (!email || !isEmail(email) || seen.has(email)) continue;
    seen.add(email);
    people.push({ email, name: grant.name });
  }
  return people.sort((a, b) => a.email.localeCompare(b.email));
}

export function reminderIdempotencyKey(organizationId: string, reportMonth: string, email: string) {
  return `monthly-record-reminder:${organizationId}:${reportMonth}:${email}`;
}

export function summaryIdempotencyKey(reportMonth: string, accountId: string) {
  return `monthly-record-reminder-summary:${reportMonth}:${accountId}`;
}

export function recordsPageUrl(baseUrl: string, organizationId: string) {
  return new URL(`/account/clubs/${encodeURIComponent(organizationId)}/records`, baseUrl).toString();
}

export function reminderEmail(input: { directorName: string; clubName: string; reportMonth: string; recordsUrl: string }) {
  const month = reportMonthLabel(input.reportMonth);
  const greeting = input.directorName.trim() ? `Hello ${input.directorName.trim()},` : "Hello,";
  return {
    subject: `${input.clubName}: ${month} Monthly Record is not submitted`,
    bodyText: [
      greeting,
      "",
      `The ${month} Monthly Record for ${input.clubName} has not been submitted yet. It was due on the 10th.`,
      "",
      `Open the Monthly Record page: ${input.recordsUrl}`,
      "",
      "If you already submitted it, thank you; it may have just crossed with this reminder.",
    ].join("\n"),
  };
}

export type ReminderSummaryCounts = {
  /** Clubs a reminder went out for, for this month. */
  reminded: number;
  /** Active clubs whose record for the month is submitted. */
  submitted: number;
  /** Every active club. */
  total: number;
};

export function summaryEmail(input: { reportMonth: string; counts: ReminderSummaryCounts }) {
  const month = reportMonthLabel(input.reportMonth);
  const { reminded, submitted, total } = input.counts;
  return {
    subject: `${month} Monthly Records: ${reminded} ${reminded === 1 ? "club" : "clubs"} reminded`,
    bodyText: [
      `Monthly Record reminders for ${month} went out today.`,
      "",
      `Clubs reminded: ${reminded}`,
      `Clubs submitted: ${submitted}`,
      `Total clubs: ${total}`,
    ].join("\n"),
  };
}

/** One reminder per club per month and one summary per coordinator per month: the shape the claim guarantees. */
export type ReminderPlanEntry = {
  clubId: string;
  clubName: string;
  recipients: ReminderRecipient[];
};

/**
 * Who is reminded: the clubs that owe the month and have not been reminded for it, each with its recipients. A club
 * with nobody to email is left out and not logged, so a director added later still gets the reminder.
 */
export function planReminders(input: {
  clubs: readonly ReminderClub[];
  reportMonth: string;
  alreadyReminded: ReadonlySet<string>;
  grantsByClub: ReadonlyMap<string, readonly ReminderGrant[]>;
}): ReminderPlanEntry[] {
  return input.clubs
    .filter((club) => !input.alreadyReminded.has(club.id) && clubOwesRecord(club, input.reportMonth))
    .map((club) => ({ clubId: club.id, clubName: club.name, recipients: reminderRecipients(input.grantsByClub.get(club.id) ?? []) }))
    .filter((entry) => entry.recipients.length > 0)
    .sort((a, b) => a.clubName.localeCompare(b.clubName, "en-US") || a.clubId.localeCompare(b.clubId));
}
