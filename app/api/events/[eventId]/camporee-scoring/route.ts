import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { camporeeApiError } from "@/modules/camporee-scoring/api-errors";
import { camporeeActionSchema } from "@/modules/camporee-scoring/domain";
import { applyCamporeeAction, requireStaffScoringAccess } from "@/modules/camporee-scoring/service";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * Staff use Camporee scoring (#1676): administrators (system administrators, Event Admins, the Clubs Administrator) switch
 * it, set up scored events, enter scores and publish; staff with the registration permission enter scores only. The
 * service decides each action. Audited where it matters: switches, set-up, publishing, and any change after publishing.
 */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const actor = await requireStaffScoringAccess(await getCurrentSession(), eventId, findActiveMembership);
    const input = camporeeActionSchema.parse(await request.json());
    const state = await applyCamporeeAction(actor, eventId, input);
    return Response.json({ state }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return camporeeApiError(error, "Saving Camporee scoring");
  }
}

export const PUT = withRequestContext(putHandler);
