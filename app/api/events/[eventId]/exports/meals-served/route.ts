import { mealRoute } from "@/modules/meals/api";
import { loadServedReport } from "@/modules/meals/scanner-import-repository";
import { servedReportCsv } from "@/modules/meals/served-report";

/**
 * Meals served against tickets sold (#1028), by service and payer. Counts only, no names. VIEW_REPORTS, like the kitchen
 * report; written by the shared CSV writer, so spreadsheet formulas are defused.
 */
export const GET = mealRoute("VIEW_REPORTS", "Exporting meals served", async ({ eventId }) => {
  const safeEventId = eventId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100) || "event";
  return new Response(servedReportCsv(await loadServedReport(eventId)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeEventId}-meals-served.csv"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}, { mutates: false });
