import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requestError } from "@/modules/cancellation-requests/api";
import { staffActionSchema } from "@/modules/cancellation-requests/domain";
import { getCancellationRequestDetail, reviewCancellationRequest } from "@/modules/cancellation-requests/repository";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * One cancellation request for staff (#170). MANAGE_FINANCE on the event in the URL; a request id from another event is
 * "not found". POST is one action by the signed-in, named person: start review, ask for information, approve or decline.
 * Approving records the decision only; it cancels, refunds and credits nothing.
 */
type Context = { params: Promise<{ eventId: string; requestId: string }> };

async function getHandler(_request: Request, context: Context) {
  try {
    const { eventId, requestId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "MANAGE_FINANCE", findActiveMembership);
    const detail = await getCancellationRequestDetail(eventId, requestId);
    if (!detail) return Response.json({ error: "REQUEST_NOT_FOUND", message: "That request could not be found for this event." }, { status: 404 });
    return Response.json({ request: detail });
  } catch (error) {
    return requestError(error, "Loading a cancellation request");
  }
}

async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, requestId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_FINANCE", findActiveMembership);
    const action = staffActionSchema.parse(await request.json());
    const outcome = await reviewCancellationRequest(eventId, requestId, { userId: access.user.id }, action);
    const detail = await getCancellationRequestDetail(eventId, requestId);
    return Response.json({ ...outcome, request: detail });
  } catch (error) {
    return requestError(error, "Reviewing a cancellation request");
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
