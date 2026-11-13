import { withRequestContext } from "@/lib/request-context";
import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { markInputSchema } from "@/modules/recognitions/domain";
import { jsonNoStore, recognitionApiError } from "@/modules/recognitions/api-errors";
import { markRecognition, requireRecognitionsOn, undoRecognition } from "@/modules/recognitions/repository";

/**
 * Mark and undo a recognition (#1683) through the audited attendee tag path: MANAGE_REGISTRATION, the same permission as the
 * attendee tag routes. Undo removes the mark and keeps who applied and removed it and when.
 */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    await requireRecognitionsOn(eventId);
    const { attendeeId, recognitionId } = markInputSchema.parse(await request.json());
    await markRecognition(eventId, attendeeId, recognitionId, access.user.id);
    return jsonNoStore({ ok: true }, 201);
  } catch (error) { return recognitionApiError(error); }
}

async function deleteHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    await requireRecognitionsOn(eventId);
    const { attendeeId, recognitionId } = markInputSchema.parse(await request.json());
    await undoRecognition(eventId, attendeeId, recognitionId, access.user.id);
    return jsonNoStore({ ok: true });
  } catch (error) { return recognitionApiError(error); }
}

export const POST = withRequestContext(postHandler);
export const DELETE = withRequestContext(deleteHandler);
