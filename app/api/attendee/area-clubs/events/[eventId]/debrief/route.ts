import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { debriefApiError } from "@/modules/event-debriefs/api-errors";
import { applyDebriefSettings, debriefSettingsSchema, requireAreaCoordinatorDebriefActor } from "@/modules/event-debriefs/settings";
import { withRequestContext } from "@/lib/request-context";

/**
 * An Area Coordinator switches the Debrief on or off for a club event (#1679). Their one write: an active grant, the second
 * sign-in step passed, this one module on club events. They cannot switch the director evaluation. Anyone else gets "not found".
 */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireAreaCoordinatorDebriefActor();
    const { eventId } = await context.params;
    const input = debriefSettingsSchema.parse(await request.json());
    const state = await applyDebriefSettings(actor, eventId, input);
    return Response.json({ state }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return debriefApiError(error, "Saving the Debrief settings");
  }
}

export const PUT = withRequestContext(putHandler);
