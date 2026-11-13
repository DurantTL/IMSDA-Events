import { rosterApiError } from "@/modules/club-rosters/api-errors";
import { ClubCalendarError } from "@/modules/club-calendar/repository";

/** Route errors for the club calendar (#1700): its own refusals as 404 (or 403), everything else through the roster's mapping. */
export function clubCalendarApiError(error: unknown, action: string) {
  if (error instanceof ClubCalendarError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.code === "NOT_ALLOWED" ? 403 : 404 });
  }
  return rosterApiError(error, action);
}
