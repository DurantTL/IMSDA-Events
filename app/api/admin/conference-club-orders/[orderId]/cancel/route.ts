import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubOrderApiError } from "@/modules/club-orders/api-errors";
import { cancelConferenceOrderAsStaff } from "@/modules/club-orders/conference-repository";
import { conferenceOrderCancelSchema } from "@/modules/club-orders/schemas";
import { requireClubsAdministration } from "@/modules/organizations/access";

/** Cancels a submitted conference club order with a reason (#1688). System administrators and Clubs Administrators (#1232). */
async function postHandler(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireClubsAdministration();
    const { orderId } = await context.params;
    const body = conferenceOrderCancelSchema.parse(await request.json());
    return Response.json(await cancelConferenceOrderAsStaff(orderId, body.reason, actor.id));
  } catch (error) {
    return clubOrderApiError(error, "Cancelling the conference club order");
  }
}

export const POST = withRequestContext(postHandler);
