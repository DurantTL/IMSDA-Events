import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { acknowledgmentApiError } from "@/modules/acknowledgments/api-errors";
import { voidAcknowledgmentEvidence } from "@/modules/acknowledgments/repository";
import { voidAcknowledgmentSchema } from "@/modules/acknowledgments/schemas";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * Void one acknowledgment (#150), the correction path. VIEW_SENSITIVE_DATA on top of the event membership, same-origin only,
 * the staff user from the session. Appends a void record with the reason; the evidence itself is never modified. Voiding twice
 * answers 200 with the first void. The registration in the URL must own the evidence.
 */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string; registrationId: string; evidenceId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, registrationId, evidenceId } = await context.params;
    const { user } = await requirePermission(await getCurrentSession(), eventId, "VIEW_SENSITIVE_DATA", findActiveMembership);
    const body = voidAcknowledgmentSchema.parse(await request.json());
    const outcome = await voidAcknowledgmentEvidence({ eventId, registrationId, evidenceId, reason: body.reason, actorUserId: user.id });
    return Response.json({ void: outcome.void, created: outcome.created }, { status: outcome.created ? 201 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return acknowledgmentApiError(error);
  }
}

export const POST = withRequestContext(postHandler);
