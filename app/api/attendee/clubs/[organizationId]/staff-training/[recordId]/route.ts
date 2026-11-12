import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkClubStaffTrainingRateLimit } from "@/modules/rate-limit/service";
import { requireStaffTrainingAccess, staffTrainingRateLimitKey } from "@/modules/staff-training/access";
import { staffTrainingApiError } from "@/modules/staff-training/api-errors";
import { removeStaffTrainingRecord } from "@/modules/staff-training/repository";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ organizationId: string; recordId: string }> };

/** The club's director or deputy removes one of their own club's staff training records (#1697). Audited. */
async function deleteHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, recordId } = await context.params;
    const { actor } = await requireStaffTrainingAccess(organizationId);
    const rateLimit = await checkClubStaffTrainingRateLimit(request, staffTrainingRateLimitKey(actor), organizationId);
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json({ error: "RATE_LIMITED", message: "Too many changes. Try again later." }, { status: 429 }), rateLimit);
    }
    await removeStaffTrainingRecord(organizationId, recordId, actor);
    return applyRateLimitHeaders(Response.json({ deleted: true }), rateLimit);
  } catch (error) {
    return staffTrainingApiError(error, "Removing a staff training record");
  }
}

export const DELETE = withRequestContext(deleteHandler);
