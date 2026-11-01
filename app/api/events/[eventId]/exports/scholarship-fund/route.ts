import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { toCsv } from "@/modules/reporting/csv";
import { scholarshipFundApiError } from "@/modules/scholarship-funds/api";
import { fundCsvRows } from "@/modules/scholarship-funds/domain";
import { exportFund } from "@/modules/scholarship-funds/repository";
import { withRequestContext } from "@/lib/request-context";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

/**
 * The scholarship fund as a finance CSV (#398): the balance, contributions against awards per sponsor or church, and
 * every contribution and award line. MANAGE_FINANCE only; sponsor names as entered, registration confirmation codes
 * and amounts, never an attendee name, birth date or health value. Formula-safe through `csvCell` (via `toCsv`). The
 * export is audited with counts only.
 */
async function getHandler(_request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_FINANCE", findActiveMembership);
    const data = await exportFund(eventId, access.user.id);
    return csvDownloadResponse(toCsv(fundCsvRows(data)), exportFileName({ scope: eventId, kind: "scholarship-fund" }));
  } catch (error) {
    return scholarshipFundApiError(error, "Exporting the scholarship fund");
  }
}

export const GET = withRequestContext(getHandler);
