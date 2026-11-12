import { rosterApiError } from "@/modules/club-rosters/api-errors";
import { ClubLetterError } from "@/modules/club-letters/repository";

/** Route errors for club letters (#1708): the limit as 409, its other refusals as 404, everything else through the roster's mapping. */
export function clubLetterApiError(error: unknown, action: string) {
  if (error instanceof ClubLetterError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.code === "LIMIT_REACHED" ? 409 : 404 });
  }
  return rosterApiError(error, action);
}
