import { AccessDeniedError } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { resolveProblemReport } from "@/modules/support/problem-reports";

/** Mark a problem report resolved (#1483). System administrators only; authorized before anything is read. */
type RouteContext = { params: Promise<{ reportId: string }> };

async function patchHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { reportId } = await context.params;
    const { user } = await getCurrentSession();
    if (!user) throw new AccessDeniedError("Authentication is required.", 401, "AUTHENTICATION_REQUIRED");
    if (user.globalRole !== "SYSTEM_ADMIN") {
      throw new AccessDeniedError("Only a system administrator can resolve a problem report.", 403, "PERMISSION_DENIED");
    }
    const resolved = await resolveProblemReport(reportId, user.id);
    if (!resolved) return Response.json({ error: "NOT_OPEN", message: "That report is not open." }, { status: 404 });
    return Response.json({ id: reportId, status: "RESOLVED" });
  } catch (error) {
    if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
    logError("Problem report could not be resolved", error);
    return Response.json({ error: "PROBLEM_REPORT_RESOLVE_FAILED", message: "The report could not be updated." }, { status: 500 });
  }
}

export const PATCH = withRequestContext(patchHandler);
