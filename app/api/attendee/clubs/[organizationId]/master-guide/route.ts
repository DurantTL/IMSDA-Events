import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { readRosterJson } from "@/modules/club-rosters/api-errors";
import { requireMasterGuideManager } from "@/modules/master-guide/access";
import { masterGuideApiError } from "@/modules/master-guide/api-errors";
import { addCandidate } from "@/modules/master-guide/repository";
import { addCandidateSchema } from "@/modules/master-guide/schemas";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkMasterGuideWriteRateLimit } from "@/modules/rate-limit/service";
import { withRequestContext } from "@/lib/request-context";

/**
 * The club's director or deputy adds a Master Guide candidate from this club year's active roster (#1698). The person must
 * be 16 or older on the start date and have a birth date on the roster. Needs the optional feature on. A registrar, a
 * reporter, an Area Coordinator and another club's director get a refusal.
 */
const noStore = { "Cache-Control": "private, no-store" };

async function postHandler(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId } = await context.params;
    const { actor } = await requireMasterGuideManager(organizationId);
    const rateLimit = await checkMasterGuideWriteRateLimit(request, "accountId" in actor ? `account:${actor.accountId}` : `user:${actor.userId}`, organizationId);
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json({ error: "RATE_LIMITED", message: "Too many changes. Try again later." }, { status: 429 }), rateLimit);
    }
    const input = addCandidateSchema.parse(await readRosterJson(request));
    const created = await addCandidate(organizationId, input, actor);
    return Response.json({ id: created.id }, { status: 201, headers: noStore });
  } catch (error) {
    return masterGuideApiError(error, "Adding the Master Guide candidate");
  }
}

export const POST = withRequestContext(postHandler);
