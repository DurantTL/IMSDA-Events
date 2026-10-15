import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { scholarshipFundApiError } from "@/modules/scholarship-funds/api";
import { createContributionSchema } from "@/modules/scholarship-funds/domain";
import { getFundView, recordContribution } from "@/modules/scholarship-funds/repository";
import { withRequestContext } from "@/lib/request-context";

/** Records money received into the event's scholarship fund (#398). It records only: no payment is taken or moved. */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_FINANCE", findActiveMembership);
    const input = createContributionSchema.parse(await request.json());
    const contributionId = await recordContribution(eventId, access.user.id, input);
    return Response.json({ contributionId, fund: await getFundView(eventId) }, { status: 201 });
  } catch (error) {
    return scholarshipFundApiError(error, "Recording a scholarship contribution");
  }
}

export const POST = withRequestContext(postHandler);
