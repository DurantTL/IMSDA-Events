/**
 * Scheduled publishing of an event page section (#1514). Times are chosen and shown in Central time. Pure, so the
 * editor, the save check and the tests share one definition.
 */

import { zonedLocalToDate } from "@/modules/events/content-countdown";

export const CONTENT_SCHEDULE_TIME_ZONE = "America/Chicago";

/** `2026-11-20T09:30` (what a datetime-local field holds) read as Central time. Null when it is not a date and time. */
export function centralLocalToIso(local: string): string | null {
  const date = zonedLocalToDate(local, CONTENT_SCHEDULE_TIME_ZONE);
  return date ? date.toISOString() : null;
}

/** An instant as the `YYYY-MM-DDTHH:MM` Central wall-clock time a datetime-local field holds. Empty for no/invalid value. */
export function isoToCentralLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: CONTENT_SCHEDULE_TIME_ZONE,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${String(Number(parts.hour) % 24).padStart(2, "0")}:${parts.minute}`;
}

/** "Nov 20, 2026, 9:30 AM CST" for display. Empty for no/invalid value. */
export function centralScheduleLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CONTENT_SCHEDULE_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export const SCHEDULE_NOT_FUTURE_MESSAGE = "Choose a publish time that is still in the future, or clear it.";
