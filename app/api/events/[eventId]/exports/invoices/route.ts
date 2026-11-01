import { AccessDeniedError, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { treasurerCsvRows } from "@/modules/invoices/delivery-domain";
import { getTreasurerCsvInvoices } from "@/modules/invoices/ledger-repository";
import { InvoiceError } from "@/modules/invoices/repository";
import { toCsv } from "@/modules/reporting/csv";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

/**
 * Finalized invoices as a CSV for the treasurer (#168): number, church, event, total, posted-to-AR date and reference,
 * paid, outstanding and the date it was last sent. The live version of each finalized invoice of the event in the
 * URL; MANAGE_FINANCE on that event. Formula-safe through the shared CSV writer. No accounting-system format.
 */
async function getHandler(_request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "MANAGE_FINANCE", findActiveMembership);
    const invoices = await getTreasurerCsvInvoices(eventId);
    return csvDownloadResponse(toCsv(treasurerCsvRows(invoices)), exportFileName({ scope: eventId, kind: "finalized-invoices" }));
  } catch (error) {
    if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
    if (error instanceof InvoiceError) return Response.json({ error: error.code, message: error.message }, { status: 404 });
    logError("Unable to export finalized invoices", error);
    return Response.json({ error: "INVOICE_EXPORT_FAILED" }, { status: 500 });
  }
}

export const GET = withRequestContext(getHandler);
