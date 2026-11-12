import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { staffingApiError } from "@/modules/event-staffing/api-errors";
import { staffingSettingsSchema } from "@/modules/event-staffing/domain";
import { applyStaffingSettings, requireAreaCoordinatorStaffingToggleActor } from "@/modules/event-staffing/settings";
import { withRequestContext } from "@/lib/request-context";

/**
 * An Area Coordinator switches Event staffing on or off for a club event (#1678). An active grant, the second sign-in step
 * passed, this one module on club events. Anyone else gets "not found".
 */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireAreaCoordinatorStaffingToggleActor();
    const { eventId } = await context.params;
    const input = staffingSettingsSchema.parse(await request.json());
    const state = await applyStaffingSettings(actor, eventId, input);
    return Response.json({ state }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return staffingApiError(error, "Saving the Event staffing setting");
  }
}

export const PUT = withRequestContext(putHandler);
