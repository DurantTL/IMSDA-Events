import { z } from "zod";
import { logError, logWarn } from "@/lib/logger";
import { DataKeyUnavailableError } from "@/lib/secret-box";
import { AccessDeniedError } from "@/modules/access/authorization";
import { RosterAccessError } from "@/modules/club-rosters/access";
import { ClubTeacherError } from "@/modules/club-teachers/repository";

const noStore = { "Cache-Control": "private, no-store" };

/** One error shape for the three Club teachers routes (staff, Area Coordinator, club director). */
export function clubTeacherApiError(error: unknown, action: string) {
  if (error instanceof z.ZodError) {
    return Response.json({ error: "INVALID_REQUEST", message: error.issues[0]?.message ?? "Review what you entered.", issues: error.issues }, { status: 400, headers: noStore });
  }
  if (error instanceof SyntaxError) return Response.json({ error: "INVALID_JSON", message: "The request is not valid JSON." }, { status: 400, headers: noStore });
  if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: noStore });
  if (error instanceof RosterAccessError) return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: noStore });
  if (error instanceof DataKeyUnavailableError) {
    logWarn(`${action} could not read a birth date: the personal-data key is unavailable`);
    return Response.json({ error: "DATA_KEY_UNAVAILABLE", message: "This can't be saved right now because birth dates are locked. Try again in a few minutes." }, { status: 503, headers: { ...noStore, "Retry-After": "60" } });
  }
  if (error instanceof ClubTeacherError && error.code === "NOT_PERMITTED") {
    return Response.json({ error: error.code, message: error.message }, { status: 403, headers: noStore });
  }
  if (error instanceof ClubTeacherError) {
    const status = error.code === "EVENT_NOT_FOUND" || error.code === "NOT_AVAILABLE" || error.code === "NOT_A_CLUB_EVENT" ? 404 : 422;
    return Response.json({ error: error.code, message: error.message }, { status, headers: noStore });
  }
  logError(`${action} failed`, error);
  return Response.json({ error: "CLUB_TEACHERS_FAILED", message: `${action} could not be completed.` }, { status: 500, headers: noStore });
}
