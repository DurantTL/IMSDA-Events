import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { acknowledgmentApiError } from "@/modules/acknowledgments/api-errors";
import { getAcknowledgmentEvidencePayload } from "@/modules/acknowledgments/repository";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * The full evidence behind one acknowledgment (#150): the wording the person was shown (by the exact version they saw,
 * never what applies now) and the approved request metadata. This is the one place that payload leaves the evidence
 * table, so it needs VIEW_SENSITIVE_DATA on top of the event membership, and it is never cached. The registration in
 * the URL must own the evidence.
 */
async function getHandler(_request: Request, context: { params: Promise<{ eventId: string; registrationId: string; evidenceId: string }> }) {
  try {
    const { eventId, registrationId, evidenceId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "VIEW_SENSITIVE_DATA", findActiveMembership);
    return Response.json(await getAcknowledgmentEvidencePayload(eventId, registrationId, evidenceId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return acknowledgmentApiError(error);
  }
}

export const GET = withRequestContext(getHandler);
