import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { eventScoringApiError } from "@/modules/event-scoring/api-errors";
import { eventScoringActionSchema } from "@/modules/event-scoring/domain";
import { applyEventScoringAction, requireAreaCoordinatorScoringActor } from "@/modules/event-scoring/service";
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
    const input = eventScoringActionSchema.parse(await request.json());
    const state = await applyEventScoringAction(actor, eventId, input);
    return Response.json({ state }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return eventScoringApiError(error, "Saving Camporee scoring");
  }
}

export const PUT = withRequestContext(putHandler);
