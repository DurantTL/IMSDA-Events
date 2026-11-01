import { mealRoute } from "@/modules/meals/api";
import { closeoutCsv, closeoutExceptionsCsv } from "@/modules/meals/closeout";
import { loadMealCloseout } from "@/modules/meals/closeout-repository";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

/**
 * Meal money closeout (#212) as CSV: the money table by default, or the exceptions with their review notes with
 * `?part=exceptions`. MANAGE_FINANCE, checked on the server from the URL's event, like the page: it holds money and
 * the names of reviewers, so the kitchen and report-only roles cannot download it. Ids and amounts only, no attendee
 * names; written by the shared CSV writer, so spreadsheet formulas are defused. The figures are the page's own.
 */
export const GET = mealRoute("MANAGE_FINANCE", "Exporting the meal closeout", async ({ request, eventId }) => {
  const exceptions = new URL(request.url).searchParams.get("part") === "exceptions";
  const closeout = await loadMealCloseout(eventId);
  return csvDownloadResponse(exceptions ? closeoutExceptionsCsv(closeout.exceptions) : closeoutCsv(closeout), exportFileName({ scope: eventId, kind: `meals-closeout${exceptions ? "-exceptions" : ""}` }));
}, { mutates: false });
