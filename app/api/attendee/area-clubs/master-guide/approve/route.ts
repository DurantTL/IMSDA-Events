import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { readRosterJson } from "@/modules/club-rosters/api-errors";
import { requireAreaCoordinatorApprover } from "@/modules/master-guide/access";
import { masterGuideApiError } from "@/modules/master-guide/api-errors";
import { approveForArea } from "@/modules/master-guide/repository";
import { areaApprovalSchema } from "@/modules/master-guide/schemas";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkMasterGuideWriteRateLimit } from "@/modules/rate-limit/service";
import { withRequestContext } from "@/lib/request-context";

/**
 * An Area Coordinator approves a Master Guide candidate the club has approved (#1698): the one write a coordinator has
 * here. An active grant and the second sign-in step on their own account; staff acting as a coordinator are refused. The club
 * must have the feature on, and the candidate must be waiting for this step. Everyone else gets "not found".
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireAreaCoordinatorApprover();
    const rateLimit = await checkMasterGuideWriteRateLimit(request, `account:${actor.accountId}`, `area:${actor.accountId}`);
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json({ error: "RATE_LIMITED", message: "Too many approvals. Try again later." }, { status: 429 }), rateLimit);
    }
    const input = areaApprovalSchema.parse(await readRosterJson(request));
    await approveForArea(input.candidateId, actor);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return masterGuideApiError(error, "Approving the Master Guide candidate");
  }
}

export const POST = withRequestContext(postHandler);
