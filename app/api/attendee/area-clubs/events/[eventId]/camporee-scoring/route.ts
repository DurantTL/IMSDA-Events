import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { camporeeApiError } from "@/modules/camporee-scoring/api-errors";
import { camporeeActionSchema } from "@/modules/camporee-scoring/domain";
import { applyCamporeeAction, requireAreaCoordinatorScoringActor } from "@/modules/camporee-scoring/service";
import { withRequestContext } from "@/lib/request-context";

/**
 * An Area Coordinator uses Camporee scoring on a club event (#1676): switch it on or off, set up scored events and enter
 * scores. Their one write: an active grant, the second sign-in step passed, this one tool on published club events.
 * They never publish. Anyone else gets "not found".
 */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireAreaCoordinatorScoringActor();
    const { eventId } = await context.params;
    const input = camporeeActionSchema.parse(await request.json());
    const state = await applyCamporeeAction(actor, eventId, input);
    return Response.json({ state }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return camporeeApiError(error, "Saving Camporee scoring");
  }
}

export const PUT = withRequestContext(putHandler);
