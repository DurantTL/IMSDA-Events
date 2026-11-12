import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { staffingApiError } from "@/modules/event-staffing/api-errors";
import { staffingSettingsSchema } from "@/modules/event-staffing/domain";
import { applyStaffingSettings, requireStaffStaffingToggleAccess } from "@/modules/event-staffing/settings";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * Staff switch Event staffing on or off (#1678): Event Admins, active Clubs Administrators (an Event Admin on club events)
 * and system administrators; Registration Managers and Finance Managers are refused. Audited.
 */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const actor = await requireStaffStaffingToggleAccess(await getCurrentSession(), eventId, findActiveMembership);
    const input = staffingSettingsSchema.parse(await request.json());
    const state = await applyStaffingSettings(actor, eventId, input);
    return Response.json({ state }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return staffingApiError(error, "Saving the Event staffing setting");
  }
}

export const PUT = withRequestContext(putHandler);
