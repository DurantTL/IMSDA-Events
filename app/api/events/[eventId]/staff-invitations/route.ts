import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { staffInvitationApiError } from "@/modules/staff-invitations/api-errors";
import { parseInvitationQuery } from "@/modules/staff-invitations/list-query";
import { listInvitations } from "@/modules/staff-invitations/repository";
import { withRequestContext } from "@/lib/request-context";

type Context = { params: Promise<{ eventId: string }> };

const noStore = { "Cache-Control": "no-store" };

/** The event's personal staff invitations with each person's status (#804). Registration managers and event administrators. */
async function getHandler(request: Request, context: Context) {
  try {
    const { eventId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    // One page: the status, group, search, order and page come from the address and the database does the work (#1492).
    const params = new URL(request.url).searchParams;
    const query = parseInvitationQuery({ status: params.get("status") ?? undefined, group: params.get("group") ?? undefined, q: params.get("q") ?? undefined, sort: params.get("sort") ?? undefined, dir: params.get("dir") ?? undefined, page: params.get("page") ?? undefined });
    return Response.json(await listInvitations(eventId, query), { headers: noStore });
  } catch (error) {
    return staffInvitationApiError(error, "Loading the staff invitations");
  }
}

export const GET = withRequestContext(getHandler);
