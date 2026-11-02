import { mealRoute } from "@/modules/meals/api";
import { kitchenCountsCsv } from "@/modules/meals/kitchen-counts";
import { loadKitchenCountsReport } from "@/modules/meals/kitchen-counts-repository";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";
import { eventFileScope } from "@/modules/reporting/export-scope";

/**
 * Kitchen counts per meal service (#1029): ordered, served, prepared, wasted, donated, transferred and the variance, as
 * separate columns. Counts and the kitchen's own notes, no names. The kitchen role or report access opens it; written by
 * the shared CSV writer, so spreadsheet formulas are defused.
 */
export const GET = mealRoute(["MANAGE_KITCHEN_COUNTS", "VIEW_REPORTS"], "Exporting kitchen counts", async ({ eventId }) => {
  return csvDownloadResponse(kitchenCountsCsv(await loadKitchenCountsReport(eventId)), exportFileName({ scope: await eventFileScope(eventId), kind: "kitchen-counts" }));
}, { mutates: false });
