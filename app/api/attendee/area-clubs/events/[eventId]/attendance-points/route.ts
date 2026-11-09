import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { attendancePointsApiError } from "@/modules/event-points/api-errors";
import { attendancePointsActionSchema } from "@/modules/event-points/domain";
import { applyAttendancePointsAction, requireAreaCoordinatorPointsActor } from "@/modules/event-points/service";
import { withRequestContext } from "@/lib/request-context";

/**
 * An Area Coordinator uses Attendance points on a club event (#1677): switch it on or off and set the points. Their one
 * write: an active grant, the second sign-in step passed, this one tool on published club events. They never apply, undo,
 * override or see a person's name. Anyone else gets "not found".
 */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireAreaCoordinatorPointsActor();
    const { eventId } = await context.params;
    const input = attendancePointsActionSchema.parse(await request.json());
    const state = await applyAttendancePointsAction(actor, eventId, input);
    return Response.json({ state }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return attendancePointsApiError(error, "Saving Attendance points");
  }
}

export const PUT = withRequestContext(putHandler);
