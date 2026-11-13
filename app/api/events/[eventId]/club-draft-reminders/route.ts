import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { getClubDraftReminderOverview, saveClubDraftReminderPolicy } from "@/modules/club-registrations/draft-reminders";
import { messagingApiError } from "@/modules/communications/api-errors";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * The reminder settings for unfinished club registrations (#164). Both routes need MANAGE_COMMUNICATIONS for this event,
 * checked here on every request. They read and write numbers and a switch; nothing a club typed passes through them, and
 * saving never sends anything.
 */
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

async function authorize(eventId: string) {
  return requirePermission(await getCurrentSession(), eventId, "MANAGE_COMMUNICATIONS", findActiveMembership);
}

function notClubEvent() {
  return Response.json({ error: "NOT_A_CLUB_EVENT", message: "Reminders for unfinished club registrations are only for published club events." }, { status: 409, headers: NO_STORE });
}

async function getHandler(_request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    await authorize(eventId);
    const overview = await getClubDraftReminderOverview(eventId);
    if (!overview) return notClubEvent();
    return Response.json({ overview }, { headers: NO_STORE });
  } catch (error) {
    return messagingApiError(error, "Loading the club registration reminders");
  }
}

async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const access = await authorize(eventId);
    const saved = await saveClubDraftReminderPolicy(eventId, access.user.id, await request.json());
    if (!saved.found) {
      return Response.json({ error: "EVENT_NOT_FOUND", message: "That event could not be found." }, { status: 404, headers: NO_STORE });
    }
    if (!saved.eligible) return notClubEvent();
    return Response.json({ changed: saved.changed, overview: await getClubDraftReminderOverview(eventId) }, { headers: NO_STORE });
  } catch (error) {
    return messagingApiError(error, "Saving the club registration reminders");
  }
}

export const GET = withRequestContext(getHandler);
export const PUT = withRequestContext(putHandler);
