import { ZodError } from "zod";
import { AreaCoordinatorError } from "@/modules/organizations/area-coordinators";
import { StaffActAsError } from "@/modules/organizations/staff-act-as";
import { logError } from "@/lib/logger";
import { AccessDeniedError } from "@/modules/access/authorization";
import { HandLinkError } from "@/modules/account-merge/hand-link";
import { UserAdminError } from "@/modules/system-admin/user-admin";

export function userAdminApiError(error: unknown, action: string) {
  if (error instanceof ZodError) {
    return Response.json({ error: "INVALID_REQUEST", message: error.issues[0]?.message ?? "Check the request.", issues: error.issues }, { status: 400 });
  }
  if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
  if (error instanceof AreaCoordinatorError) {
    return Response.json({ error: error.code, message: error.message }, { status: 404 });
  }
  if (error instanceof StaffActAsError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.code === "ACT_AS_CONFLICT" ? 409 : 404 });
  }
  if (error instanceof UserAdminError) {
    const status = error.code === "ACCOUNT_NOT_FOUND" ? 404 : error.code === "EMAIL_NOT_CONFIGURED" ? 503 : error.code === "RATE_LIMITED" ? 429 : 409;
    return Response.json({ error: error.code, message: error.message }, { status });
  }
  if (error instanceof HandLinkError) {
    const status = error.code === "NOT_SYSTEM_ADMIN" ? 403
      : error.code === "REASON_REQUIRED" ? 400
        : error.code === "USER_NOT_FOUND" || error.code === "ACCOUNT_NOT_FOUND" || error.code === "NOT_LINKED" ? 404
          : 409;
    return Response.json({ error: error.code, message: error.message }, { status });
  }
  // A body that is not JSON is the caller's mistake, not a server failure.
  if (error instanceof SyntaxError) {
    return Response.json({ error: "INVALID_REQUEST", message: "The request body must be JSON." }, { status: 400 });
  }
  logError(`${action} failed`, error);
  return Response.json({ error: "USER_ADMIN_FAILED", message: `${action} could not be completed.` }, { status: 500 });
}
