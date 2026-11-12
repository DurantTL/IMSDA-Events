import { rejectGuestClubOtherEvent } from "@/modules/club-registrations/event-gate";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { actorAttribution, requireRosterAccess } from "@/modules/club-rosters/access";
import { clubTeacherApiError } from "@/modules/club-teachers/api-errors";
import { teacherEntriesSchema } from "@/modules/club-teachers/domain";
import { setClubTeachers } from "@/modules/club-teachers/repository";
import { withRequestContext } from "@/lib/request-context";

/** A club names who from the club is teaching (#1681). Only while the event's Club teachers tool is on; never blocks by itself. */
async function putHandler(request: Request, context: { params: Promise<{ organizationId: string; eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, eventId } = await context.params;
    const access = await requireRosterAccess(organizationId, new Date(), "registerForEvents");
    const guestBlock = await rejectGuestClubOtherEvent(organizationId, eventId);
    if (guestBlock) return guestBlock;
    const input = teacherEntriesSchema.parse(await request.json());
    const step = await setClubTeachers(organizationId, eventId, actorAttribution(access.actor), input);
    return Response.json({ step }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return clubTeacherApiError(error, "Saving your club's teachers");
  }
}

export const PUT = withRequestContext(putHandler);
