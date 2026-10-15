import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { scholarshipFundApiError } from "@/modules/scholarship-funds/api";
import { getFundView, settlePledgedAward } from "@/modules/scholarship-funds/repository";
import { withRequestContext } from "@/lib/request-context";

/** Marks a pledged scholarship as received, once its money is recorded and unspent in the fund (#398). */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string; awardId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, awardId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_FINANCE", findActiveMembership);
    await settlePledgedAward(eventId, awardId, access.user.id);
    return Response.json({ fund: await getFundView(eventId) });
  } catch (error) {
    return scholarshipFundApiError(error, "Marking a scholarship pledge received");
  }
}

export const POST = withRequestContext(postHandler);
