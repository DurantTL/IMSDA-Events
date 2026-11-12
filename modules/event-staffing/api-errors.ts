import { z } from "zod";
import { logError } from "@/lib/logger";
import { AccessDeniedError } from "@/modules/access/authorization";
import { StaffingError } from "@/modules/event-staffing/access";

const noStore = { "Cache-Control": "private, no-store" };

/** One error shape for the staffing sheet routes (staff and Area Coordinator). */
export function staffingApiError(error: unknown, action: string) {
  if (error instanceof z.ZodError) {
    return Response.json({ error: "INVALID_REQUEST", message: error.issues[0]?.message ?? "Review what you entered.", issues: error.issues }, { status: 400, headers: noStore });
  }
  if (error instanceof SyntaxError) return Response.json({ error: "INVALID_JSON", message: "The request is not valid JSON." }, { status: 400, headers: noStore });
  if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: noStore });
  if (error instanceof StaffingError) {
    const missing = error.code === "EVENT_NOT_FOUND" || error.code === "NOT_AVAILABLE" || error.code === "MODULE_OFF" || error.code === "ACTIVITY_NOT_FOUND" || error.code === "ASSIGNMENT_NOT_FOUND";
    const status = error.code === "NOT_PERMITTED" ? 403 : missing ? 404 : error.code === "CONFLICT" ? 409 : 422;
    return Response.json({ error: error.code, message: error.message }, { status, headers: noStore });
  }
  logError(`${action} failed`, error);
  return Response.json({ error: "STAFFING_FAILED", message: `${action} could not be completed.` }, { status: 500, headers: noStore });
}
