import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { baptismApiError, jsonNoStore } from "@/modules/baptism-follow-up/api-errors";
import { baptismSwitchInputSchema } from "@/modules/baptism-follow-up/domain";
import { applyBaptismFollowUpSwitch } from "@/modules/baptism-follow-up/settings";
import { requireAreaCoordinatorToggleActor } from "@/modules/event-modules/scoped-toggle";

/**
 * An Area Coordinator switches Baptism follow-up on or off for a published club event (#1680). An active grant, the second
 * sign-in step passed. Anyone else, including staff acting as a coordinator, gets "not found".
 */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireAreaCoordinatorToggleActor();
    const { eventId } = await context.params;
    const { enabled } = baptismSwitchInputSchema.parse(await request.json());
    return jsonNoStore(await applyBaptismFollowUpSwitch(actor, eventId, enabled));
  } catch (error) {
    return baptismApiError(error, { log: "Switching baptism follow-up failed", message: "The switch could not be changed." });
  }
}

export const PUT = withRequestContext(putHandler);
