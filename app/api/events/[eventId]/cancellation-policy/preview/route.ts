import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { cancellationPolicyApiError } from "@/modules/cancellation-policy/api";
import { previewCancellation, previewRequestSchema } from "@/modules/cancellation-policy/repository";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * Preview of a proposed cancellation outcome (#169) for one registration of this event, or synthetic input. A POST
 * because it carries a structured request, not because it changes anything: it writes nothing and cancels, refunds
 * and credits nothing.
 */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "MANAGE_FINANCE", findActiveMembership);
    const input = previewRequestSchema.parse(await request.json());
    return Response.json(await previewCancellation(eventId, input));
  } catch (error) {
    return cancellationPolicyApiError(error, "Previewing a cancellation");
  }
}

export const POST = withRequestContext(postHandler);
