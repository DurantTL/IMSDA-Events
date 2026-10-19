import { mealRoute } from "@/modules/meals/api";
import { kitchenCountsCsv } from "@/modules/meals/kitchen-counts";
import { loadKitchenCountsReport } from "@/modules/meals/kitchen-counts-repository";

/**
 * Kitchen counts per meal service (#1029): ordered, served, prepared, wasted, donated, transferred and the variance, as
 * separate columns. Counts and the kitchen's own notes, no names. The kitchen role or report access opens it; written by
 * the shared CSV writer, so spreadsheet formulas are defused.
 */
export const GET = mealRoute(["MANAGE_KITCHEN_COUNTS", "VIEW_REPORTS"], "Exporting kitchen counts", async ({ eventId }) => {
  const safeEventId = eventId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100) || "event";
  return new Response(kitchenCountsCsv(await loadKitchenCountsReport(eventId)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeEventId}-kitchen-counts.csv"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}, { mutates: false });
