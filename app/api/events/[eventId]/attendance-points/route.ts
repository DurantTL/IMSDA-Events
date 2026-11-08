import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { attendancePointsApiError } from "@/modules/event-points/api-errors";
import { attendancePointsActionSchema } from "@/modules/event-points/domain";
import { applyAttendancePointsAction, requireStaffPointsAccess } from "@/modules/event-points/service";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * Staff use Attendance points (#1677): administrators only (system administrators, Event Admins, the Clubs Administrator).
 * They switch it, set the points, mark an Area Coordinator's child, override a club, and apply or undo the points. The
 * service decides each action. Every change is audited with ids and numbers only.
 */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const actor = await requireStaffPointsAccess(await getCurrentSession(), eventId, findActiveMembership);
    const input = attendancePointsActionSchema.parse(await request.json());
    const state = await applyAttendancePointsAction(actor, eventId, input);
    return Response.json({ state }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return attendancePointsApiError(error, "Saving Attendance points");
  }
}

export const PUT = withRequestContext(putHandler);
