import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { staffInvitationApiError } from "@/modules/staff-invitations/api-errors";
import { listInvitations } from "@/modules/staff-invitations/repository";
import { withRequestContext } from "@/lib/request-context";

type Context = { params: Promise<{ eventId: string }> };

const noStore = { "Cache-Control": "no-store" };

/** The event's personal staff invitations with each person's status (#804). Registration managers and event administrators. */
async function getHandler(_request: Request, context: Context) {
  try {
    const { eventId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    return Response.json(await listInvitations(eventId), { headers: noStore });
  } catch (error) {
    return staffInvitationApiError(error, "Loading the staff invitations");
  }
}

export const GET = withRequestContext(getHandler);
