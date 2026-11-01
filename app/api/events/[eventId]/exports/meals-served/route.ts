import { mealRoute } from "@/modules/meals/api";
import { loadServedReport } from "@/modules/meals/scanner-import-repository";
import { servedReportCsv } from "@/modules/meals/served-report";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

/**
 * Meals served against tickets sold (#1028), by service and payer. Counts only, no names. VIEW_REPORTS, like the kitchen
 * report; written by the shared CSV writer, so spreadsheet formulas are defused.
 */
export const GET = mealRoute("VIEW_REPORTS", "Exporting meals served", async ({ eventId }) => {
  return csvDownloadResponse(servedReportCsv(await loadServedReport(eventId)), exportFileName({ scope: eventId, kind: "meals-served" }));
}, { mutates: false });
