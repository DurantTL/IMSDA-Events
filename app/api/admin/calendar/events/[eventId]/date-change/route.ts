import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { calendarFeedApiError } from "@/modules/calendar/api-errors";
import { resolveCalendarDateChange } from "@/modules/calendar/event-links";
import { calendarEventDateDecisionSchema } from "@/modules/calendar/schemas";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

type Context = { params: Promise<{ eventId: string }> };

/**
 * Staff's answer to "Google Calendar moved this event: update the registration
 * dates?" (#445): Update or Keep current dates. Never called by anything but a
 * staff member's click. Whoever may configure this event may answer, checked on
 * the server through event membership: a system administrator, or the event's own
 * Event Admin. Linking and unlinking stay with system administrators.
 */
async function postHandler(request: Request, { params }: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await params;
    const access = await requirePermission(await getCurrentSession(), eventId, "CONFIGURE_EVENT", findActiveMembership);
    const input = calendarEventDateDecisionSchema.parse(await request.json());
    await resolveCalendarDateChange(eventId, input.decision, { startsOn: input.startsOn, endsOn: input.endsOn }, access.user.id, input.entryId);
    return Response.json({ decision: input.decision });
  } catch (error) {
    return calendarFeedApiError(error, "Answering the calendar date change");
  }
}

export const POST = withRequestContext(postHandler);
