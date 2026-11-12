import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireMasterGuideManager } from "@/modules/master-guide/access";
import { masterGuideApiError } from "@/modules/master-guide/api-errors";
import { approveForClub } from "@/modules/master-guide/repository";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkMasterGuideWriteRateLimit } from "@/modules/rate-limit/service";
import { withRequestContext } from "@/lib/request-context";

/**
 * The club's director or deputy approves a candidate for the club (#1698): in progress to approved by the club, and only
 * when the candidate is 18 or older today with a birth date on the roster. Needs the optional feature on.
 */
async function postHandler(request: Request, context: { params: Promise<{ organizationId: string; candidateId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, candidateId } = await context.params;
    const { actor } = await requireMasterGuideManager(organizationId);
    const rateLimit = await checkMasterGuideWriteRateLimit(request, "accountId" in actor ? `account:${actor.accountId}` : `user:${actor.userId}`, organizationId);
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json({ error: "RATE_LIMITED", message: "Too many changes. Try again later." }, { status: 429 }), rateLimit);
    }
    await approveForClub(organizationId, candidateId, actor);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return masterGuideApiError(error, "Approving the Master Guide candidate");
  }
}

export const POST = withRequestContext(postHandler);
