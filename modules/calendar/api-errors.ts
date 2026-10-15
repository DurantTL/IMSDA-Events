import { ZodError } from "zod";
import { AccessDeniedError } from "@/modules/access/authorization";
import { DeadlineReminderError } from "@/modules/calendar/deadline-reminders";
import { CalendarError } from "@/modules/calendar/repository";
import { logError } from "@/lib/logger";

const calendarErrorStatus: Record<CalendarError["code"], number> = {
  ENTRY_NOT_FOUND: 404,
  EVENT_NOT_FOUND: 404,
  FEED_NOT_FOUND: 404,
  INVALID_REPEAT: 400,
  INVALID_FEED: 400,
  NOT_IMPORTED: 400,
  NOT_LINKABLE: 409,
  ENTRY_ALREADY_LINKED: 409,
  EVENT_ALREADY_LINKED: 409,
  NOT_LINKED: 409,
  EVENT_ARCHIVED: 409,
  DATES_CHANGED: 409,
  DATES_CONFLICT: 409,
  FEED_FETCH_FAILED: 502,
  FEED_SECRET_MISSING: 503,
};

/**
 * Errors for the imported-calendar routes. A request body here can hold a
 * private feed address, so a validation error reports where and why, never the
 * submitted value.
 */
export function calendarFeedApiError(error: unknown, action: string) {
  if (error instanceof ZodError) {
    return Response.json(
      {
        error: "INVALID_CALENDAR_REQUEST",
        message: error.issues[0]?.message ?? "Check the details and try again.",
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
      { status: 400 },
    );
  }
  return calendarApiError(error, action);
}

const reminderErrorStatus: Record<DeadlineReminderError["code"], number> = {
  BATCH_NOT_FOUND: 404,
  BATCH_NOT_PENDING: 409,
  BATCH_WITHDRAWN: 409,
  BATCH_CHANGED: 409,
  EMAIL_NOT_CONFIGURED: 503,
  NO_RECIPIENTS: 409,
};

export function calendarApiError(error: unknown, action: string) {
  if (error instanceof ZodError) {
    return Response.json(
      { error: "INVALID_CALENDAR_REQUEST", message: error.issues[0]?.message, issues: error.issues },
      { status: 400 },
    );
  }
  if (error instanceof AccessDeniedError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status });
  }
  if (error instanceof DeadlineReminderError) {
    return Response.json({ error: error.code, message: error.message }, { status: reminderErrorStatus[error.code] });
  }
  if (error instanceof CalendarError) {
    return Response.json({ error: error.code, message: error.message }, { status: calendarErrorStatus[error.code] });
  }
  logError(`${action} failed`, error);
  return Response.json(
    { error: "CALENDAR_REQUEST_FAILED", message: `${action} could not be completed.` },
    { status: 500 },
  );
}
