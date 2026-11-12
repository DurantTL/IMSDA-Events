import { rejectGuestClubOtherEvent } from "@/modules/club-registrations/event-gate";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { actorAttribution, requireRosterAccess } from "@/modules/club-rosters/access";
import { clubRegistrationApiError } from "@/modules/club-registrations/api-errors";
import { acceptClassWaitlistOffer } from "@/modules/honors/waitlist-repository";
import { withRequestContext } from "@/lib/request-context";

/** The director accepts a seat offered from a class waitlist (#831). The server re-checks the youth qualifies and the seat is still held. */
async function postHandler(request: Request, context: { params: Promise<{ organizationId: string; eventId: string; entryId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, eventId, entryId } = await context.params;
    const access = await requireRosterAccess(organizationId, new Date(), "registerForEvents");
    const guestBlock = await rejectGuestClubOtherEvent(organizationId, eventId);
    if (guestBlock) return guestBlock;
    const workspace = await acceptClassWaitlistOffer(organizationId, eventId, actorAttribution(access.actor), entryId);
    return Response.json({ workspace }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return clubRegistrationApiError(error, "Accepting a class waitlist offer");
  }
}

export const POST = withRequestContext(postHandler);
