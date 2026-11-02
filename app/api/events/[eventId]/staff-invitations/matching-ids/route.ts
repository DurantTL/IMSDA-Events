import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { staffInvitationApiError } from "@/modules/staff-invitations/api-errors";
import { parseInvitationFilters } from "@/modules/staff-invitations/list-query";
import { listMatchingInvitationIds } from "@/modules/staff-invitations/repository";
import { withRequestContext } from "@/lib/request-context";

type Context = { params: Promise<{ eventId: string }> };

/**
 * "Select all N matching" (#1492): the ids of every invitation of this event the filters match, across all pages, up to the
 * most one Send or Revoke takes. Read only, with the same permission as the list (registration managers and event
 * administrators). Sending still needs MANAGE_COMMUNICATIONS and re-reads each id for this event when it runs.
 */
async function getHandler(request: Request, context: Context) {
  try {
    const { eventId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    const params = new URL(request.url).searchParams;
    const filters = parseInvitationFilters({ status: params.get("status") ?? undefined, group: params.get("group") ?? undefined, q: params.get("q") ?? undefined });
    return Response.json(await listMatchingInvitationIds(eventId, filters), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return staffInvitationApiError(error, "Finding the matching staff invitations");
  }
}

export const GET = withRequestContext(getHandler);
