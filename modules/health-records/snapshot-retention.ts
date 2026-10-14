import { localMidnightInstant, nextDateKey } from "@/modules/cancellation-policy/event-time";
import { ageOn, parseCalendarDate } from "@/modules/club-rosters/domain";

/**
 * How long a sealed per-event health copy is kept (#924, ADR 0005 Addendum B).
 * Pure: no database, no secrets, no I/O.
 *
 * These periods are research, not legal advice. Adventist Risk Management or
 * conference counsel is to confirm them, and they are constants here so a
 * change is a one-line edit with no migration (each snapshot stores the
 * expiry computed from them when it was sealed; a changed rule applies to
 * snapshots sealed afterwards, or to a recompute counsel asks for).
 *
 * Sources (from the issue; the Missouri limit sets the period):
 * - RSMo 516.120 gives 5 years for a personal-injury claim, and RSMo 516.170
 *   starts the clock for a minor at age 21, so a minor's claim runs to 26.
 * - Iowa is shorter (2 years, or until 19 for a minor; Iowa Code 614.1(2) and
 *   614.8), so Missouri governs.
 * - RSMo 537.046: incident reports involving a minor are kept to age 31.
 */
export const HEALTH_SNAPSHOT_RETENTION = {
  /** Younger than this on the event's first day is a minor. */
  minorUnderAge: 18,
  /** A minor's copy is kept until this birthday. */
  minorKeepUntilAge: 26,
  /** An adult's copy is kept this many years after the event's last day. */
  adultYearsAfterEvent: 5,
  /**
   * Incident reports that involve a minor are kept until this birthday (RSMo 537.046).
   * Incident records do not exist yet; this records the rule for when they do. Nothing reads it today.
   */
  incidentReportMinorKeepUntilAge: 31,
  /** Nightly database backups kept, rolling. The snapshots cover the long-term legal need, so backups need not. */
  nightlyBackupsKept: 30,
} as const;

/**
 * With no birth date, the youngest age the person could plausibly have had on the event day, so the
 * 26th-birthday reading is the latest plausible one. A reported age (a form's answer) wins over the member type.
 */
export const HEALTH_SNAPSHOT_YOUNGEST_PLAUSIBLE_AGE: Record<string, number> = {
  UNDERAGE: 0,
  YOUTH: 4,
  STAFF: 16,
  ADULT: 18,
};

/**
 * The time zone a copy's keep-until day is read in: the conference's (Central). The day ends at local midnight here,
 * not at UTC midnight, which is the evening before.
 */
export const HEALTH_SNAPSHOT_EXPIRY_TIME_ZONE = "America/Chicago";

/**
 * Extra days a copy is kept after the end of its keep-until day, so a claim filed on the last day can still get a
 * legal hold before the deletion job runs. Owner-chosen (not from a statute); counsel is to confirm it (ADR 0005
 * Addendum B). A change applies to copies sealed afterwards.
 */
export const HEALTH_SNAPSHOT_GRACE_DAYS = 90;

/** Break-glass access lasts this long (ADR 0005, decided 2026-10-09). */
export const HEALTH_SNAPSHOT_BREAK_GLASS_HOURS = 24;

/** The event-start trigger only catches up on events that started within this many days, so a copy is never of a record far later than the event. */
export const HEALTH_SNAPSHOT_START_CATCH_UP_DAYS = 3;

/** The retention job runs at most once in this many hours. */
export const HEALTH_SNAPSHOT_RETENTION_RUN_HOURS = 20;

/** A reason typed for a hold, a lift or break-glass. */
export const HEALTH_SNAPSHOT_REASON_MIN = 10;
export const HEALTH_SNAPSHOT_REASON_MAX = 500;

export type SnapshotAgeBasis = "MINOR" | "ADULT" | "UNKNOWN";

/** Adds whole years to a calendar date (`YYYY-MM-DD`). A Feb 29 date lands on Mar 1 in a year with no Feb 29 (the later day, the safer one for keeping). */
export function addYearsToCalendarDate(date: string, years: number) {
  const parsed = parseCalendarDate(date);
  if (!parsed) throw new Error("Not a calendar date.");
  return new Date(Date.UTC(parsed.year + years, parsed.month - 1, parsed.day)).toISOString().slice(0, 10);
}

/** Adds whole days to a calendar date (`YYYY-MM-DD`). Calendar arithmetic only. */
export function addDaysToCalendarDate(date: string, days: number) {
  const parsed = parseCalendarDate(date);
  if (!parsed) throw new Error("Not a calendar date.");
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days)).toISOString().slice(0, 10);
}

/**
 * The instant a copy whose keep-until day is `expiresOn` is deleted from: the start of the day AFTER that day in
 * Central time, plus the grace days (counted as calendar days, so a daylight saving change never shifts the hour).
 */
export function snapshotDeleteFrom(expiresOn: string) {
  const day = nextDateKey(addDaysToCalendarDate(expiresOn, HEALTH_SNAPSHOT_GRACE_DAYS));
  return localMidnightInstant(day, HEALTH_SNAPSHOT_EXPIRY_TIME_ZONE);
}

/**
 * The age a roster says the person was at the event, from the row for the event's own club year. With only a later
 * year, the reported age is lowered by the year gap (they were younger then). With only an earlier year, its age is
 * used as reported (never raised, so the reading errs towards the younger age and the longer keep). Null when no row
 * reports an age. Only the age is read here, never a birth date.
 */
export function reportedAgeAtEvent(rows: Array<{ clubYear: string; reportedAge: number | null }>, eventClubYear: string): number | null {
  const startOf = (clubYear: string) => Number(clubYear.slice(0, 4));
  const eventYear = startOf(eventClubYear);
  const withAge = rows.filter((row) => row.reportedAge !== null && Number.isFinite(startOf(row.clubYear)));
  const same = withAge.find((row) => startOf(row.clubYear) === eventYear);
  if (same) return same.reportedAge;
  const later = withAge.filter((row) => startOf(row.clubYear) > eventYear).sort((a, b) => startOf(a.clubYear) - startOf(b.clubYear))[0];
  if (later) return Math.max(0, (later.reportedAge as number) - (startOf(later.clubYear) - eventYear));
  const earlier = withAge.filter((row) => startOf(row.clubYear) < eventYear).sort((a, b) => startOf(b.clubYear) - startOf(a.clubYear))[0];
  return earlier ? earlier.reportedAge : null;
}

function laterOf(a: string, b: string) {
  return a >= b ? a : b;
}

export type SnapshotExpiryInput = {
  /** The event's first and last calendar day, in the event's time zone. */
  eventStartDate: string;
  eventEndDate: string;
  /** A calendar date, or null when the roster has none. Never stored on the snapshot. */
  birthDate: string | null;
  reportedAge: number | null;
  attendeeType: string | null;
};

/**
 * The keep-until day (`expiresOn`) and the instant the copy becomes deletable (`expiresAt`, see `snapshotDeleteFrom`:
 * the start of the next day in Central time plus the grace days). The keep-until day is worked out from the birth date at the event:
 * - under 18 on the event's first day: their 26th birthday;
 * - 18 or over: 5 years after the event's last day;
 * - no usable birth date: the longer of 5 years after the event and the 26th
 *   birthday on the latest plausible reading, that is, taking the youngest
 *   age the person could have had (the reported age, else the youngest age for
 *   their member type). Choosing the longer period when the age is unknown errs
 *   on keeping the record the conference may need, and the decision is recorded
 *   in ADR 0005 Addendum B.
 */
export function computeSnapshotExpiry(input: SnapshotExpiryInput): { ageBasis: SnapshotAgeBasis; expiresOn: string; expiresAt: Date } {
  const rule = HEALTH_SNAPSHOT_RETENTION;
  const adultExpiry = addYearsToCalendarDate(input.eventEndDate, rule.adultYearsAfterEvent);
  let ageBasis: SnapshotAgeBasis;
  let expiresOn: string;

  const age = input.birthDate && parseCalendarDate(input.birthDate) && input.birthDate <= input.eventStartDate
    ? ageOn(input.birthDate, input.eventStartDate)
    : null;
  if (input.birthDate && age !== null && age >= 0 && age <= 120) {
    if (age < rule.minorUnderAge) {
      ageBasis = "MINOR";
      expiresOn = laterOf(addYearsToCalendarDate(input.birthDate, rule.minorKeepUntilAge), adultExpiry);
    } else {
      ageBasis = "ADULT";
      expiresOn = adultExpiry;
    }
  } else {
    ageBasis = "UNKNOWN";
    const reported = input.reportedAge !== null && input.reportedAge >= 0 && input.reportedAge <= 120 ? input.reportedAge : null;
    const youngest = reported ?? (input.attendeeType ? HEALTH_SNAPSHOT_YOUNGEST_PLAUSIBLE_AGE[input.attendeeType] : undefined) ?? 0;
    // Latest plausible birth date: they turned `youngest` on the event's first day.
    const latestBirth = addYearsToCalendarDate(input.eventStartDate, -youngest);
    expiresOn = laterOf(addYearsToCalendarDate(latestBirth, rule.minorKeepUntilAge), adultExpiry);
  }
  return { ageBasis, expiresOn, expiresAt: snapshotDeleteFrom(expiresOn) };
}

/** True once `expiresAt` has come (see `snapshotDeleteFrom`). */
export function snapshotExpired(expiresAt: Date, now: Date) {
  return expiresAt.getTime() <= now.getTime();
}
