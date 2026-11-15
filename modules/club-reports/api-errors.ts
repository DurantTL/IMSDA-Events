import { ZodError } from "zod";
import { logError, logWarn } from "@/lib/logger";
import { DataKeyUnavailableError } from "@/lib/secret-box";
import { AccessDeniedError } from "@/modules/access/authorization";
import { RosterAccessError } from "@/modules/club-rosters/access";
import { ClubReportError } from "@/modules/club-reports/repository";

export function clubReportApiError(error: unknown, action: string) {
  if (error instanceof ZodError) {
    return Response.json({ error: "INVALID_CLUB_REPORT", message: error.issues[0]?.message, issues: error.issues }, { status: 400 });
  }
  if (error instanceof RosterAccessError || error instanceof AccessDeniedError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status });
  }
  if (error instanceof DataKeyUnavailableError) {
    logWarn(`${action}: birth dates are locked (the personal-data key is unavailable)`);
    return Response.json(
      { error: "DATA_KEY_UNAVAILABLE", message: "The Year-End Report can't be saved right now because birth dates are locked. Try again in a few minutes." },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }
  if (error instanceof ClubReportError) {
    const status = error.code === "CLUB_NOT_FOUND" || error.code === "CLUB_REPORT_NOT_FOUND"
      ? 404
      : error.code === "CLUB_REPORT_LOCKED" || error.code === "CLUB_REPORT_ITEMS_LOCKED" || error.code === "CLUB_REPORT_CONFLICT"
        ? 409
        : 400;
    return Response.json({ error: error.code, message: error.message }, { status });
  }
  logError(`${action} failed`, error);
  return Response.json({ error: "CLUB_REPORT_FAILED", message: `${action} could not be completed.` }, { status: 500 });
}
