import { mealRoute } from "@/modules/meals/api";
import { mealTicketsCsv } from "@/modules/meals/view-repository";

/**
 * Meal tickets for the café's own scanner (#210; scanning itself is not built here): one row per active selection of a
 * submitted or confirmed registration, with the confirmation code, the person, age group and attendee type, the meal and
 * its service date, the quantity and who pays. Written by the shared CSV writer, so spreadsheet formulas are defused.
 * VIEW_REPORTS, like the kitchen report.
 */
export const GET = mealRoute("VIEW_REPORTS", "Exporting meal tickets", async ({ eventId }) => {
  const safeEventId = eventId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100) || "event";
  return new Response(await mealTicketsCsv(eventId), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeEventId}-meal-tickets.csv"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}, { mutates: false });
