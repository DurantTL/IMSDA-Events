import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { scholarshipFundApiError } from "@/modules/scholarship-funds/api";
import { reverseContributionSchema } from "@/modules/scholarship-funds/domain";
import { getFundView, reverseContribution } from "@/modules/scholarship-funds/repository";
import { withRequestContext } from "@/lib/request-context";

/** Cancels a recorded contribution with an opposite line; the original stays on record (#398). */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string; contributionId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, contributionId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_FINANCE", findActiveMembership);
    const { reason } = reverseContributionSchema.parse(await request.json());
    await reverseContribution(eventId, contributionId, access.user.id, reason);
    return Response.json({ fund: await getFundView(eventId) });
  } catch (error) {
    return scholarshipFundApiError(error, "Reversing a scholarship contribution");
  }
}

export const POST = withRequestContext(postHandler);
