import { requireAnyPermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { closeoutApiError, closeoutHeaders } from "@/modules/events/closeout-api";
import { getCloseoutView } from "@/modules/events/closeout-repository";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * The closeout checklist and sign-off history of one event (#1515). MANAGE_FINANCE, FINALIZE_INVOICES or VIEW_REPORTS.
 * Counts, amounts, states and the names of the people who signed off or reopened; no attendee names or contact details.
 */
async function getHandler(_request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    await requireAnyPermission(await getCurrentSession(), eventId, ["MANAGE_FINANCE", "FINALIZE_INVOICES", "VIEW_REPORTS"], findActiveMembership);
    const closeout = await getCloseoutView(eventId);
    return closeout
      ? Response.json({ closeout }, { headers: closeoutHeaders })
      : Response.json({ error: "EVENT_NOT_FOUND", message: "That event no longer exists." }, { status: 404, headers: closeoutHeaders });
  } catch (error) { return closeoutApiError(error); }
}

export const GET = withRequestContext(getHandler);
