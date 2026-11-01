import { mealRoute } from "@/modules/meals/api";
import { mealTicketsCsv } from "@/modules/meals/view-repository";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

/**
 * Meal tickets in the conference café scanner's import format (#916): one row per ticket (a selection of 3 is three
 * rows) with stable `MT-` ids, exactly the scanner's columns. Active, ticketed selections of a submitted or confirmed
 * registration only. The per-selection summary is `exports/meal-ticket-summary`. Written by the shared CSV writer, so
 * spreadsheet formulas are defused. VIEW_REPORTS, like the kitchen report.
 */
export const GET = mealRoute("VIEW_REPORTS", "Exporting meal tickets", async ({ eventId }) => {
  return csvDownloadResponse(await mealTicketsCsv(eventId), exportFileName({ scope: eventId, kind: "meal-tickets" }));
}, { mutates: false });
