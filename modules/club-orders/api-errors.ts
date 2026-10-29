import { ZodError } from "zod";
import { logError } from "@/lib/logger";
import { AccessDeniedError } from "@/modules/access/authorization";
import { ClubOrderError } from "@/modules/club-orders/repository";
import { RosterAccessError } from "@/modules/club-rosters/access";

/** Maps club order errors to responses (#487), the same shape as club supplies (#531). */
export function clubOrderApiError(error: unknown, action: string) {
  if (error instanceof ZodError) {
    return Response.json(
      { error: "INVALID_CLUB_ORDER_REQUEST", message: error.issues[0]?.message, issues: error.issues },
      { status: 400 },
    );
  }
  if (error instanceof RosterAccessError || error instanceof AccessDeniedError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status });
  }
  if (error instanceof ClubOrderError) {
    const status = error.code === "BATCH_NOT_FOUND" || error.code === "CLASS_NOT_COMPLETED" || error.code === "HONOR_NOT_FOUND" ? 404 : error.code === "DATE_IN_FUTURE" ? 400 : 409;
    return Response.json({ error: error.code, message: error.message }, { status });
  }
  logError(`${action} failed`, error);
  return Response.json(
    { error: "CLUB_ORDER_REQUEST_FAILED", message: `${action} could not be completed.` },
    { status: 500 },
  );
}
