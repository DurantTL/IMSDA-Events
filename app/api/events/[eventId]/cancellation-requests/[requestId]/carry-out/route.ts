import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { executionError, executionJson } from "@/modules/cancellation-execution/api";
import { carryOutInputSchema } from "@/modules/cancellation-execution/domain";
import { carryOutCancellation, getCarryOutPanel } from "@/modules/cancellation-execution/repository";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * Carrying out one approved cancellation request (#171). MANAGE_FINANCE on the event in the URL, by a named, signed-in
 * staff member who pressed "Carry out" (or "Continue"). This route is the only caller of `carryOutCancellation`: no
 * scheduler, worker or webhook reaches it, and approving a request never does.
 */
type Context = { params: Promise<{ eventId: string; requestId: string }> };

const maximumBodyBytes = 2 * 1_024;

async function getHandler(_request: Request, context: Context) {
  try {
    const { eventId, requestId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "MANAGE_FINANCE", findActiveMembership);
    const panel = await getCarryOutPanel(eventId, requestId);
    if (!panel) return executionJson({ error: "NOT_APPROVED", message: "Only an approved request can be carried out." }, { status: 404 });
    return executionJson({ panel });
  } catch (error) {
    return executionError(error);
  }
}

async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, requestId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_FINANCE", findActiveMembership);
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > maximumBodyBytes) return executionJson({ error: "REQUEST_TOO_LARGE", message: "The request is too large." }, { status: 413 });
    const input = carryOutInputSchema.parse(JSON.parse(body));
    const execution = await carryOutCancellation(eventId, requestId, { userId: access.user.id }, input);
    return executionJson({ execution });
  } catch (error) {
    return executionError(error);
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
