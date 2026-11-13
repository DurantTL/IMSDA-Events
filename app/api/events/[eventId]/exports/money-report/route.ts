import { AccessDeniedError, requireAnyPermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { toCsv } from "@/modules/reporting/csv";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";
import { eventFileScope } from "@/modules/reporting/export-scope";
import { moneyReportCsvRows } from "@/modules/payments/event-money-report-domain";
import { exportEventMoneyReport } from "@/modules/payments/event-money-report-repository";

/**
 * The Event money report as a CSV (#1962): figures with what each includes, the reconciliation, and the registrations
 * that still owe, by confirmation code. MANAGE_FINANCE or VIEW_REPORTS. No names, contact details, birth dates or
 * health values. Formula-safe through `toCsv`. The download is audited with counts only. The Square list is live and
 * is not in the file; the page shows it.
 */
async function getHandler(_request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    const access = await requireAnyPermission(await getCurrentSession(), eventId, ["MANAGE_FINANCE", "VIEW_REPORTS"], findActiveMembership);
    const { eventName, report } = await exportEventMoneyReport(eventId, access.user.id);
    const body = toCsv(moneyReportCsvRows(eventName, report, "Square payments not yet matched to a registration are read live from Square and are shown on the page, not in this file."));
    return csvDownloadResponse(body, exportFileName({ scope: await eventFileScope(eventId), kind: "money-report" }));
  } catch (error) {
    if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
    logError("Exporting the event money report failed", error);
    return Response.json({ error: "MONEY_REPORT_FAILED", message: "The money report could not be downloaded." }, { status: 500 });
  }
}

export const GET = withRequestContext(getHandler);
