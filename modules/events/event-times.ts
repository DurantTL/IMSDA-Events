import { zonedLocalToDate } from "@/modules/events/content-countdown";

/**
 * Event start and end instants (#1406). Creation asks for a start and an end time, and the event stores them as that
 * wall-clock time in the event's own time zone. With no time given, the day's noon UTC is stored, as it was before
 * creation asked for times, so older callers and scripts keep working. Pure; no server-only imports.
 */

export const DEFAULT_EVENT_TIME_ZONE = "America/Chicago";

/** "HH:MM", 24-hour, as `<input type="time">` submits it. */
export const timeOfDayPattern = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The stored instant for a calendar day when no time is chosen: noon UTC. */
export function noonUtc(calendarDate: string): Date {
  return new Date(`${calendarDate}T12:00:00.000Z`);
}

/** The instant for a calendar day at a wall-clock time in a time zone; noon UTC when no (valid) time is given. */
export function eventInstant(calendarDate: string, time: string | null | undefined, timeZone: string): Date {
  if (!time || !timeOfDayPattern.test(time)) return noonUtc(calendarDate);
  return zonedLocalToDate(`${calendarDate}T${time}`, timeZone) ?? noonUtc(calendarDate);
}

/** "HH:MM" of an instant on the wall clock of a time zone. */
export function localClockTime(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${String(Number(parts.hour) % 24).padStart(2, "0")}:${parts.minute}`;
}

/**
 * A settings save moves the dates and keeps the event's clock time (#1406): the stored time of day, read in the
 * event's current time zone, is combined with the new date in the saved time zone. A stored noon UTC is the old
 * "no time chosen" value and stays noon UTC, so saving an older event does not shift it.
 */
export function keepClockTime(existing: Date, existingTimeZone: string, newCalendarDate: string, newTimeZone: string): Date {
  if (existing.getUTCHours() === 12 && existing.getUTCMinutes() === 0 && existing.getUTCSeconds() === 0 && existing.getUTCMilliseconds() === 0) {
    return noonUtc(newCalendarDate);
  }
  return eventInstant(newCalendarDate, localClockTime(existing, existingTimeZone), newTimeZone);
}

/** Plain-language problems with the chosen times, keyed by field. Empty when the times are fine or absent. */
export function eventTimeProblems(input: { startsOn: string; endsOn: string; startTime?: string | null; endTime?: string | null }): { startTime?: string; endTime?: string } {
  const problems: { startTime?: string; endTime?: string } = {};
  if (input.startTime && !timeOfDayPattern.test(input.startTime)) problems.startTime = "Enter the start time as hours and minutes, like 7:00 AM.";
  if (input.endTime && !timeOfDayPattern.test(input.endTime)) problems.endTime = "Enter the end time as hours and minutes, like 5:00 PM.";
  if (!problems.endTime && input.startTime && input.endTime && input.startsOn === input.endsOn && input.endTime < input.startTime) {
    problems.endTime = "The event cannot end before it starts. Choose an end time after the start time.";
  }
  return problems;
}
