import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireSystemAdministrator } from "@/modules/organizations/access";
import { calendarFeedApiError } from "@/modules/calendar/api-errors";
import { dismissPossibleMatch, linkCalendarEntryToEvent, unlinkCalendarEntry } from "@/modules/calendar/event-links";
import { listCalendarEntries, listCalendarEvents } from "@/modules/calendar/repository";
import { calendarEntryEventLinkSchema } from "@/modules/calendar/schemas";
import { withRequestContext } from "@/lib/request-context";

type Context = { params: Promise<{ entryId: string }> };

/**
 * Link a calendar item to an existing registration event, unlink it, or dismiss
 * a suggested pair as "not the same" (#445). Same permission as the rest of the
 * calendar admin: system administrators only.
 */
async function postHandler(request: Request, { params }: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireSystemAdministrator();
    const { entryId } = await params;
    const input = calendarEntryEventLinkSchema.parse(await request.json());
    if (input.action === "link") await linkCalendarEntryToEvent(entryId, input.eventId, actor.id);
    else if (input.action === "unlink") await unlinkCalendarEntry(entryId, actor.id);
    else await dismissPossibleMatch(entryId, input.eventId, actor.id);
    return Response.json({ entries: await listCalendarEntries(), events: await listCalendarEvents() });
  } catch (error) {
    return calendarFeedApiError(error, "Changing a calendar item's registration link");
  }
}

export const POST = withRequestContext(postHandler);
