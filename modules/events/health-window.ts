import { calendarDateInEventTimeZone } from "@/modules/events/lifecycle";

/**
 * The one definition of the event health window, shared by the Pathfinder
 * Health Record (`modules/health-records`, #611) and the coordinator health
 * view (`modules/coordinator-health`, #658). Pure: no database, no I/O.
 *
 * Owner decision of 2026-10-14 (#923, ADR 0005 Addendum B): event health
 * access ends when the event ends. For an Area Coordinator and for the event
 * health role the window closes at the end of the event's last day, inclusive,
 * in the event's time zone. It used to stay open 30 days longer.
 */

/** Days the window stays open after the event's last day. Zero: it closes with the event. */
export const HEALTH_WINDOW_DAYS = 0;

function addCalendarDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The last calendar day (event time zone, inclusive) an event's health information may be opened. */
export function healthWindowEndsOn(event: { timezone: string; endsAt: Date }) {
  return addCalendarDays(calendarDateInEventTimeZone(event.endsAt, event.timezone), HEALTH_WINDOW_DAYS);
}

/**
 * Open from registration (a person can only be an attendee after registering,
 * so there is no start bound of its own) through the event's last day.
 */
export function healthWindowOpen(event: { timezone: string; endsAt: Date }, now: Date = new Date()) {
  return calendarDateInEventTimeZone(now, event.timezone) <= healthWindowEndsOn(event);
}
