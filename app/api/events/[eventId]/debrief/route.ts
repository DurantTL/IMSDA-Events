import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { debriefApiError } from "@/modules/event-debriefs/api-errors";
import { applyDebriefSettings, debriefSettingsSchema, requireStaffDebriefAccess } from "@/modules/event-debriefs/settings";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * Staff switch the Debrief, and its club director evaluation, on or off (#1679): Event Admins, active Clubs Administrators
 * (an Event Admin on club events) and system administrators; Registration Managers are refused. Audited.
 */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const actor = await requireStaffDebriefAccess(await getCurrentSession(), eventId, findActiveMembership);
    const input = debriefSettingsSchema.parse(await request.json());
    const state = await applyDebriefSettings(actor, eventId, input);
    return Response.json({ state }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return debriefApiError(error, "Saving the Debrief settings");
  }
}

export const PUT = withRequestContext(putHandler);
