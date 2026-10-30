import { CONFERENCE_TIME_ZONE } from "@/modules/calendar/domain";

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
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

/** The cached formatter itself, for callers that need `formatToParts`. */
export function conferenceDateFormat(options: Intl.DateTimeFormatOptions = {}, locale = "en-US") {
  const key = JSON.stringify([locale, options]);
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: CONFERENCE_TIME_ZONE });
    formatters.set(key, formatter);
  }
  return formatter;
}

/** An invalid date prints "Invalid Date", like `toLocale*String`, instead of throwing. */
export function formatInConferenceTime(value: Date | string | number, options: Intl.DateTimeFormatOptions = {}, locale = "en-US") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid Date";
  return conferenceDateFormat(options, locale).format(date);
}
