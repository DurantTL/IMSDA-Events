import { ZodError } from "zod";
import { logError } from "@/lib/logger";
import { AccessDeniedError } from "@/modules/access/authorization";
import { EmergencyPlanError } from "@/modules/emergency-plans/access";

/** Maps emergency plan failures to responses (#114). A disabled module is a plain 404 and never carries data. */
export function emergencyPlanApiError(error: unknown, action: string) {
  if (error instanceof ZodError) {
    return Response.json({ error: "INVALID_EMERGENCY_PLAN", message: error.issues[0]?.message, issues: error.issues }, { status: 400 });
  }
  if (error instanceof AccessDeniedError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status });
  }
  if (error instanceof EmergencyPlanError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status });
  }
  logError(`${action} failed`, error);
  return Response.json({ error: "EMERGENCY_PLAN_REQUEST_FAILED", message: `${action} could not be completed.` }, { status: 500 });
}
