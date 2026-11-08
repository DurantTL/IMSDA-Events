import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubOrderApiError } from "@/modules/club-orders/api-errors";
import { fillConferenceOrder } from "@/modules/club-orders/conference-repository";
import { conferenceOrderFillSchema } from "@/modules/club-orders/schemas";
import { requireClubsAdministration } from "@/modules/organizations/access";

/**
 * Marks a conference club order Filled (#1688): postage as typed, added to the sponsoring church's bill as a draft invoice
 * line (never finalized here), and optionally to the club's stock. System administrators and Clubs Administrators (#1232).
 */
async function postHandler(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireClubsAdministration();
    const { orderId } = await context.params;
    const body = conferenceOrderFillSchema.parse(await request.json());
    return Response.json(await fillConferenceOrder(orderId, { postage: body.postage ?? "", addToStock: body.addToStock }, actor.id));
  } catch (error) {
    return clubOrderApiError(error, "Filling the conference club order");
  }
}

export const POST = withRequestContext(postHandler);
