import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { inspectionActionSchema } from "@/modules/event-inspections/domain";
import { applyInspectionAction } from "@/modules/event-inspections/service";
import { eventScoringApiError } from "@/modules/event-scoring/api-errors";
import { requireStaffScoringAccess } from "@/modules/event-scoring/service";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * Staff use Inspections (#1896): administrators switch it and enter scores; staff with the registration permission enter
 * scores only (the same people as Camporee scoring). One small request for each score, so a weak connection loses one row.
 */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const actor = await requireStaffScoringAccess(await getCurrentSession(), eventId, findActiveMembership);
    const input = inspectionActionSchema.parse(await request.json());
    const result = await applyInspectionAction(actor, eventId, input);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return eventScoringApiError(error, "Saving the inspection score");
  }
}

export const PUT = withRequestContext(putHandler);
