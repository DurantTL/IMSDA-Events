import { mealRoute } from "@/modules/meals/api";
import { mealTicketsCsv } from "@/modules/meals/view-repository";

/**
 * Meal tickets in the conference café scanner's import format (#916): one row per ticket (a selection of 3 is three
 * rows) with stable `MT-` ids, exactly the scanner's columns. Active, ticketed selections of a submitted or confirmed
 * registration only. The per-selection summary is `exports/meal-ticket-summary`. Written by the shared CSV writer, so
 * spreadsheet formulas are defused. VIEW_REPORTS, like the kitchen report.
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
