import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { inspectionActionSchema } from "@/modules/event-inspections/domain";
import { applyInspectionAction } from "@/modules/event-inspections/service";
import { eventScoringApiError } from "@/modules/event-scoring/api-errors";
import { requireAreaCoordinatorScoringActor } from "@/modules/event-scoring/service";
import { withRequestContext } from "@/lib/request-context";

/**
 * An Area Coordinator uses Inspections on a club event (#1896): switch it and enter scores. An active grant and the second
 * sign-in step, as for Camporee scoring. Anyone else gets "not found".
 */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireAreaCoordinatorScoringActor();
    const { eventId } = await context.params;
    const input = inspectionActionSchema.parse(await request.json());
    const result = await applyInspectionAction(actor, eventId, input);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return eventScoringApiError(error, "Saving the inspection score");
  }
}

export const PUT = withRequestContext(putHandler);
