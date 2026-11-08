import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubOrderApiError } from "@/modules/club-orders/api-errors";
import { cancelConferenceOrderAsDirector } from "@/modules/club-orders/conference-repository";
import { requireClubSupplyEditAccess } from "@/modules/club-supplies/access";

type RouteContext = { params: Promise<{ organizationId: string; orderId: string }> };

/** A director cancels their club's conference order (#1688), only while it is still Submitted. */
async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, orderId } = await context.params;
    const actor = await requireClubSupplyEditAccess(organizationId);
    return Response.json(await cancelConferenceOrderAsDirector(organizationId, orderId, actor));
  } catch (error) {
    return clubOrderApiError(error, "Cancelling the conference order");
  }
}

export const POST = withRequestContext(postHandler);
