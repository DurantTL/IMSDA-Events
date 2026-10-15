import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { hashUserAgent } from "@/modules/access/tokens";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { acknowledgmentApiError } from "@/modules/acknowledgments/api-errors";
import { AcknowledgmentError, listRegistrationAcknowledgments, recordStaffAcknowledgment } from "@/modules/acknowledgments/repository";
import { acknowledgmentStatusQuerySchema, staffAcknowledgmentSchema } from "@/modules/acknowledgments/schemas";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * Acknowledgment status and staff-recorded evidence for one registration (#150).
 *
 * GET answers where each person stands on each acknowledgment, as of `?at=` (default now): summaries only, never the
 * wording shown or request metadata. POST records an acknowledgment given on screen or on paper; the wording comes from
 * the registration's own form version. Both need MANAGE_REGISTRATION on the event in the URL, which the repository
 * checks again by refusing any registration or attendee that is not on that event. POST is same-origin only and takes
 * the acting staff user from the session, never the body.
 */

type RouteContext = { params: Promise<{ eventId: string; registrationId: string }> };

async function getHandler(request: Request, context: RouteContext) {
  try {
    const { eventId, registrationId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    const query = acknowledgmentStatusQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const acknowledgments = await listRegistrationAcknowledgments(eventId, registrationId, query.at ? new Date(query.at) : undefined);
    if (!acknowledgments) throw new AcknowledgmentError("REGISTRATION_NOT_FOUND", "That registration was not found for this event.");
    return Response.json({ acknowledgments }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return acknowledgmentApiError(error);
  }
}

async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, registrationId } = await context.params;
    const { user } = await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    const body = staffAcknowledgmentSchema.parse(await request.json());
    const outcome = await recordStaffAcknowledgment({
      eventId,
      registrationId,
      fieldKey: body.fieldKey,
      attendeeId: body.attendeeId ?? null,
      actedByPersonId: body.actedByPersonId ?? null,
      channel: body.channel,
      acknowledgedAt: body.acknowledgedAt ? new Date(body.acknowledgedAt) : null,
      actorUserId: user.id,
      clientRequestId: body.clientRequestId,
      requestMetadata: { userAgentHash: hashUserAgent(request.headers.get("user-agent")), submissionKey: body.clientRequestId },
    });
    return Response.json(
      { evidence: outcome.evidence, created: outcome.created, replayed: outcome.replayed },
      { status: outcome.created ? 201 : 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return acknowledgmentApiError(error);
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
