import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { readRosterJson } from "@/modules/club-rosters/api-errors";
import { requireMasterGuideManager } from "@/modules/master-guide/access";
import { masterGuideApiError } from "@/modules/master-guide/api-errors";
import { removeCandidate, updateCandidate } from "@/modules/master-guide/repository";
import { updateCandidateSchema } from "@/modules/master-guide/schemas";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkMasterGuideWriteRateLimit } from "@/modules/rate-limit/service";
import { withRequestContext } from "@/lib/request-context";

/**
 * The club's director or deputy changes a candidate's start date and mentor, or removes the candidate, while the
 * candidate is still in progress (#1698). Needs the optional feature on.
 */
const noStore = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ organizationId: string; candidateId: string }> };

async function gate(request: Request, organizationId: string) {
  const { actor } = await requireMasterGuideManager(organizationId);
  const rateLimit = await checkMasterGuideWriteRateLimit(request, "accountId" in actor ? `account:${actor.accountId}` : `user:${actor.userId}`, organizationId);
  return { actor, rateLimit };
}

const limited = (rateLimit: Awaited<ReturnType<typeof checkMasterGuideWriteRateLimit>>) =>
  applyRateLimitHeaders(Response.json({ error: "RATE_LIMITED", message: "Too many changes. Try again later." }, { status: 429 }), rateLimit);

async function patchHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, candidateId } = await context.params;
    const { actor, rateLimit } = await gate(request, organizationId);
    if (!rateLimit.allowed) return limited(rateLimit);
    const input = updateCandidateSchema.parse(await readRosterJson(request));
    await updateCandidate(organizationId, candidateId, input, actor);
    return Response.json({ ok: true }, { headers: noStore });
  } catch (error) {
    return masterGuideApiError(error, "Saving the Master Guide candidate");
  }
}

async function deleteHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, candidateId } = await context.params;
    const { actor, rateLimit } = await gate(request, organizationId);
    if (!rateLimit.allowed) return limited(rateLimit);
    await removeCandidate(organizationId, candidateId, actor);
    return Response.json({ ok: true }, { headers: noStore });
  } catch (error) {
    return masterGuideApiError(error, "Removing the Master Guide candidate");
  }
}

export const PATCH = withRequestContext(patchHandler);
export const DELETE = withRequestContext(deleteHandler);
