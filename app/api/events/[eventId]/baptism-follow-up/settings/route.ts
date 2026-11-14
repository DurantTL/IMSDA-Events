import { withRequestContext } from "@/lib/request-context";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { baptismApiError, jsonNoStore } from "@/modules/baptism-follow-up/api-errors";
import { baptismSwitchInputSchema } from "@/modules/baptism-follow-up/domain";
import { applyBaptismFollowUpSwitch } from "@/modules/baptism-follow-up/settings";
import { requireStaffToggleAccess } from "@/modules/event-modules/scoped-toggle";
import { findActiveMembership } from "@/modules/events/repository";

/** Switch Baptism follow-up on or off (#1680): a system administrator, an Event Admin or the Clubs Administrator; checked on the server. */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const actor = await requireStaffToggleAccess(await getCurrentSession(), eventId, findActiveMembership);
    const { enabled } = baptismSwitchInputSchema.parse(await request.json());
    return jsonNoStore(await applyBaptismFollowUpSwitch(actor, eventId, enabled));
  } catch (error) {
    return baptismApiError(error, { log: "Switching baptism follow-up failed", message: "The switch could not be changed." });
  }
}

export const PUT = withRequestContext(putHandler);
