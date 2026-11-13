import { withRequestContext } from "@/lib/request-context";
import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { jsonNoStore, recognitionApiError } from "@/modules/recognitions/api-errors";
import { createRecognition, loadRecognitionSummary, requireRecognitionsOn } from "@/modules/recognitions/repository";

/**
 * Event recognitions (#1683). Reading the definitions and totals is for staff who can mark (MANAGE_REGISTRATION, the permission
 * the attendee tag routes use); listing a recognition is event setup (CONFIGURE_EVENT, like creating a tag). Checked on the server
 * for every call; the Recognitions module being on only keeps a switched-off tool from being used.
 */
async function getHandler(_request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    await requireRecognitionsOn(eventId);
    return jsonNoStore(await loadRecognitionSummary(eventId));
  } catch (error) { return recognitionApiError(error); }
}

async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "CONFIGURE_EVENT", findActiveMembership);
    await requireRecognitionsOn(eventId);
    const recognition = await createRecognition(eventId, access.user.id, await request.json());
    return jsonNoStore({ recognition }, 201);
  } catch (error) { return recognitionApiError(error); }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
