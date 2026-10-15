import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { scholarshipFundApiError } from "@/modules/scholarship-funds/api";
import { getFundView, listSponsorDirectory } from "@/modules/scholarship-funds/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * The event's scholarship fund (#398): balance, matching view, lines, and the church and club directory for the
 * sponsor picker. MANAGE_FINANCE only; read-only.
 */
async function getHandler(_request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "MANAGE_FINANCE", findActiveMembership);
    const [fund, directory] = await Promise.all([getFundView(eventId), listSponsorDirectory()]);
    return Response.json({ fund, directory }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return scholarshipFundApiError(error, "Reading the scholarship fund");
  }
}

export const GET = withRequestContext(getHandler);
