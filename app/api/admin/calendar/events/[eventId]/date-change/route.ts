import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireSystemAdministrator } from "@/modules/organizations/access";
import { calendarFeedApiError } from "@/modules/calendar/api-errors";
import { resolveCalendarDateChange } from "@/modules/calendar/event-links";
import { calendarEventDateDecisionSchema } from "@/modules/calendar/schemas";
import { withRequestContext } from "@/lib/request-context";

type Context = { params: Promise<{ eventId: string }> };

/**
 * Staff's answer to "Google Calendar moved this event: update the registration
 * dates?" (#445): Update or Keep current dates. Never called by anything but a
 * staff member's click.
 */
async function postHandler(request: Request, { params }: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireSystemAdministrator();
    const { eventId } = await params;
    const input = calendarEventDateDecisionSchema.parse(await request.json());
    await resolveCalendarDateChange(eventId, input.decision, { startsOn: input.startsOn, endsOn: input.endsOn }, actor.id);
    return Response.json({ decision: input.decision });
  } catch (error) {
    return calendarFeedApiError(error, "Answering the calendar date change");
  }
}

export const POST = withRequestContext(postHandler);
