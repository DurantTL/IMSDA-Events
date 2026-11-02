import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { acknowledgmentApiError } from "@/modules/acknowledgments/api-errors";
import { withdrawAcknowledgmentEvidence } from "@/modules/acknowledgments/repository";
import { withdrawAcknowledgmentSchema } from "@/modules/acknowledgments/schemas";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * Withdraw one acknowledgment (#130). MANAGE_REGISTRATION, same-origin only, the staff user from the session. Appends a
 * withdrawal record; the acceptance itself is never modified and stays evidence for the period before the withdrawal. Who
 * withdrew follows who may acknowledge for that person (themselves, or for a minor their declared responsible adult). A voided
 * acknowledgment or a decline answers 409. Withdrawing twice answers 200 with the first withdrawal. A paper form needs
 * `paperLocation` (where the paper is kept, never what it says). The registration in the URL must own the evidence.
 */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string; registrationId: string; evidenceId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, registrationId, evidenceId } = await context.params;
    const { user } = await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    const body = withdrawAcknowledgmentSchema.parse(await request.json());
    const outcome = await withdrawAcknowledgmentEvidence({
      eventId,
      registrationId,
      evidenceId,
      channel: body.channel,
      actedByPersonId: body.actedByPersonId ?? null,
      withdrawnAt: body.withdrawnAt ? new Date(body.withdrawnAt) : null,
      paperLocation: body.paperLocation ?? null,
      clientRequestId: body.clientRequestId,
      actorUserId: user.id,
    });
    return Response.json(
      { withdrawal: outcome.withdrawal, created: outcome.created, replayed: outcome.replayed },
      { status: outcome.created ? 201 : 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return acknowledgmentApiError(error);
  }
}

export const POST = withRequestContext(postHandler);
