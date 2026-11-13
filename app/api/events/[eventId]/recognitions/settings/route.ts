import { withRequestContext } from "@/lib/request-context";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { requireStaffToggleAccess, ScopedToggleError } from "@/modules/event-modules/scoped-toggle";
import { jsonNoStore, recognitionApiError } from "@/modules/recognitions/api-errors";
import { switchInputSchema } from "@/modules/recognitions/domain";
import { applyRecognitionsSwitch } from "@/modules/recognitions/settings";

/** Switch Recognitions on or off (#1683): a system administrator, an Event Admin or the Clubs Administrator; checked on the server. */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const actor = await requireStaffToggleAccess(await getCurrentSession(), eventId, findActiveMembership);
    const { enabled } = switchInputSchema.parse(await request.json());
    return jsonNoStore(await applyRecognitionsSwitch(actor, eventId, enabled));
  } catch (error) {
    if (error instanceof ScopedToggleError) return jsonNoStore({ error: error.code, message: error.message }, 404);
    return recognitionApiError(error);
  }
}

export const PUT = withRequestContext(putHandler);
