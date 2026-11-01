/** Kept here, with no imports, so client components that only format a date stay light; `calendar/domain` re-exports it. */
export const CONFERENCE_TIME_ZONE = "America/Chicago";

/** The zone is fixed, so a caller cannot pass one and have it silently ignored. */
type ConferenceDateFormatOptions = Omit<Intl.DateTimeFormatOptions, "timeZone">;

/**
 * Display formatting in the conference's time zone (America/Chicago), never the
 * server's or the browser's. Pure and client-safe.
 *
 * It matches `value.toLocaleDateString(locale, { ...options, timeZone })` when
 * the options name date fields (or none at all: numeric year, month and day),
 * `toLocaleString` when they are `dateStyle` / `timeStyle`, and
 * `toLocaleTimeString` when they name time fields. Pass explicit fields:
 * `toLocaleString` and `toLocaleTimeString` with no fields would add defaults
 * that `Intl.DateTimeFormat` does not.
 *
 * This raw formatter never adds a zone label; `formatInConferenceTime` below labels every time of day (#1454).
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

/** The cached formatter itself, for callers that need `formatToParts`. */
export function conferenceDateFormat(options: ConferenceDateFormatOptions = {}, locale = "en-US") {
  const key = JSON.stringify([locale, options]);
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: CONFERENCE_TIME_ZONE });
    formatters.set(key, formatter);
  }
  return formatter;
}

const TIME_KEYS = ["hour", "minute", "second", "dayPeriod", "fractionalSecondDigits", "timeStyle"] as const;

/**
 * `zoneLabel: false` is the explicit opt-out for a caller that builds a range
 * and labels it once itself ("Fri 4:00 PM – Sun 12:00 PM CDT").
 */
export type ZonedFormatOptions = Omit<Intl.DateTimeFormatOptions, "timeZone"> & { zoneLabel?: boolean };

const zonedFormatters = new Map<string, Intl.DateTimeFormat>();

function zonedFormat(timeZone: string, options: Intl.DateTimeFormatOptions, locale: string) {
  const key = JSON.stringify([locale, timeZone, options]);
  let formatter = zonedFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    zonedFormatters.set(key, formatter);
  }
  return formatter;
}

function zoneNamePart(date: Date, timeZone: string, locale: string, timeZoneName: "short" | "longGeneric") {
  return zonedFormat(timeZone, { timeZoneName }, locale).formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "";
}

/**
 * The same as `formatInConferenceTime` for an event whose own zone is not
 * Chicago. Whenever the options show a time of day, the short zone name is
 * added ("3:30 AM CDT") unless the caller passes `timeZoneName` itself or
 * `zoneLabel: false`. Date-only options are never labeled. An invalid date
 * prints "Invalid Date", like `toLocale*String`, instead of throwing.
 */
export function formatInTimeZone(value: Date | string | number, timeZone: string, options: ZonedFormatOptions = {}, locale = "en-US") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid Date";
  const { zoneLabel = true, ...intlOptions } = options;
  const showsTime = TIME_KEYS.some((key) => intlOptions[key] !== undefined);
  if (!showsTime || !zoneLabel || intlOptions.timeZoneName) return zonedFormat(timeZone, intlOptions, locale).format(date);
  if (intlOptions.timeStyle) {
    // Intl rejects timeStyle together with timeZoneName; "full" and "long" already end in a zone name.
    const text = zonedFormat(timeZone, intlOptions, locale).format(date);
    return intlOptions.timeStyle === "full" || intlOptions.timeStyle === "long" ? text : `${text} ${zoneNamePart(date, timeZone, locale, "short")}`;
  }
  return zonedFormat(timeZone, { ...intlOptions, timeZoneName: "short" }, locale).format(date);
}

export function formatInConferenceTime(value: Date | string | number, options: ZonedFormatOptions = {}, locale = "en-US") {
  return formatInTimeZone(value, CONFERENCE_TIME_ZONE, options, locale);
}

/** The short zone name in force at that instant ("CDT" in summer, "CST" in winter), for callers that label a range once. */
export function shortZoneName(value: Date | string | number, timeZone: string = CONFERENCE_TIME_ZONE, locale = "en-US") {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : zoneNamePart(date, timeZone, locale, "short");
}

/** The long form for "Times are shown in …" copy: "Central Time". */
export function timeZoneLongName(timeZone: string = CONFERENCE_TIME_ZONE, locale = "en-US") {
  return zoneNamePart(new Date(), timeZone, locale, "longGeneric");
}
