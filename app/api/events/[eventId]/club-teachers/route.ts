import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubTeacherApiError } from "@/modules/club-teachers/api-errors";
import { teacherSettingsSchema } from "@/modules/club-teachers/domain";
import { applyTeacherSettings, requireStaffTeacherToolAccess } from "@/modules/club-teachers/settings";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * Staff switch the Club teachers tool on or off and set its rule (#1681): Event Admins, active Clubs Administrators
 * (on club events) and system administrators, through the club tools' MANAGE_REGISTRATION check. Audited.
 */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const actor = await requireStaffTeacherToolAccess(await getCurrentSession(), eventId, findActiveMembership);
    const input = teacherSettingsSchema.parse(await request.json());
    const state = await applyTeacherSettings(actor, eventId, input);
    return Response.json({ state }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return clubTeacherApiError(error, "Saving the Club teachers settings");
  }
}

export const PUT = withRequestContext(putHandler);
