import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { baptismApiError, jsonNoStore } from "@/modules/baptism-follow-up/api-errors";
import { followUpInputSchema } from "@/modules/baptism-follow-up/domain";
import { updateBaptismFollowUp } from "@/modules/baptism-follow-up/follow-up";
import { requireAreaCoordinatorToggleActor } from "@/modules/event-modules/scoped-toggle";

/** An Area Coordinator marks one baptism name followed up and keeps a note (#1680). The row is found by the event and its id together. Audited without the name or the note. */
async function patchHandler(request: Request, context: { params: Promise<{ eventId: string; followUpId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireAreaCoordinatorToggleActor();
    const { eventId, followUpId } = await context.params;
    const input = followUpInputSchema.parse(await request.json());
    return jsonNoStore({ status: await updateBaptismFollowUp(actor, eventId, followUpId, input) });
  } catch (error) {
    return baptismApiError(error, { log: "Saving a baptism follow-up status failed", message: "The status could not be saved." });
  }
}

export const PATCH = withRequestContext(patchHandler);
