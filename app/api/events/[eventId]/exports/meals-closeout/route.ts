import { mealRoute } from "@/modules/meals/api";
import { closeoutCsv, closeoutExceptionsCsv } from "@/modules/meals/closeout";
import { loadMealCloseout } from "@/modules/meals/closeout-repository";

/**
 * Meal money closeout (#212) as CSV: the money table by default, or the exceptions with their review notes with
 * `?part=exceptions`. MANAGE_FINANCE, checked on the server from the URL's event, like the page: it holds money and
 * the names of reviewers, so the kitchen and report-only roles cannot download it. Ids and amounts only, no attendee
 * names; written by the shared CSV writer, so spreadsheet formulas are defused. The figures are the page's own.
 */
export const GET = mealRoute("MANAGE_FINANCE", "Exporting the meal closeout", async ({ request, eventId }) => {
  const safeEventId = eventId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100) || "event";
  const exceptions = new URL(request.url).searchParams.get("part") === "exceptions";
  const closeout = await loadMealCloseout(eventId);
  return new Response(exceptions ? closeoutExceptionsCsv(closeout.exceptions) : closeoutCsv(closeout), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeEventId}-meals-closeout${exceptions ? "-exceptions" : ""}.csv"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}, { mutates: false });
