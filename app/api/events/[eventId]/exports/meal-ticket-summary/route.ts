import { mealRoute } from "@/modules/meals/api";
import { mealTicketSummaryCsv } from "@/modules/meals/view-repository";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

/**
 * The meal ticket summary: one row per active selection of a submitted or confirmed registration, with the
 * confirmation code, the person, age group and attendee type, the meal and its service date, the quantity and who
 * pays. This is the export that came before the café scanner's file (`exports/meal-tickets`, one row per ticket).
 * Written by the shared CSV writer, so spreadsheet formulas are defused. VIEW_REPORTS, like the kitchen report.
 */
export const GET = mealRoute("VIEW_REPORTS", "Exporting the meal ticket summary", async ({ eventId }) => {
  return csvDownloadResponse(await mealTicketSummaryCsv(eventId), exportFileName({ scope: eventId, kind: "meal-ticket-summary" }));
}, { mutates: false });
