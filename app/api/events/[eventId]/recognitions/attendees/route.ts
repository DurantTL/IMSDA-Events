import { withRequestContext } from "@/lib/request-context";
import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { searchQuerySchema } from "@/modules/recognitions/domain";
import { jsonNoStore, recognitionApiError } from "@/modules/recognitions/api-errors";
import { requireRecognitionsOn, searchRecognitionAttendees } from "@/modules/recognitions/repository";

/** Search this event's club attendees by name to mark one (#1683). MANAGE_REGISTRATION; names and club only. */
async function getHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    await requireRecognitionsOn(eventId);
    const query = searchQuerySchema.parse(new URL(request.url).searchParams.get("q") ?? "");
    return jsonNoStore({ results: await searchRecognitionAttendees(eventId, query) });
  } catch (error) { return recognitionApiError(error); }
}

export const GET = withRequestContext(getHandler);
