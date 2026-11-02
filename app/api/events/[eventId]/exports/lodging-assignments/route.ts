import { effectivePermissions, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { lodgingApiError } from "@/modules/lodging/api-errors";
import { isLodgingReportKind, lodgingReportCsv } from "@/modules/lodging/assignment-export";
import { getRoomingReports } from "@/modules/lodging/assignment-view";
import { withRequestContext } from "@/lib/request-context";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";
import { eventFileScope } from "@/modules/reporting/export-scope";

/**
 * The rooming list and the other lodging reports as CSV (`?report=assignments|occupancy|unassigned|conflicts|closeout|keys`).
 * VIEW_REPORTS. Written by the shared CSV writer (spreadsheet formulas are defused). Names appear, as on any rooming
 * list; contact details never do. The accessibility columns exist only for staff holding VIEW_SENSITIVE_DATA. The
 * assignments file is the one the confirmed CSV import reads.
 */
async function getHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "VIEW_REPORTS", findActiveMembership);
    const canSeeSensitive = new Set(effectivePermissions(access.user, access.membership)).has("VIEW_SENSITIVE_DATA");
    const requested = new URL(request.url).searchParams.get("report") ?? "assignments";
    if (!isLodgingReportKind(requested)) {
      return Response.json({ error: "INVALID_LODGING_INPUT", message: "Choose assignments, occupancy, unassigned, conflicts, closeout or keys." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const reports = await getRoomingReports(eventId, { canSeeSensitive });
    return csvDownloadResponse(lodgingReportCsv(requested, reports), exportFileName({ scope: await eventFileScope(eventId), kind: `lodging-${requested}` }));
  } catch (error) {
    return lodgingApiError(error, "Exporting the lodging report");
  }
}

export const GET = withRequestContext(getHandler);
