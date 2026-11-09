import { withRequestContext } from "@/lib/request-context";
import { resolveAreaCoordinatorViewer } from "@/modules/club-forms/access";
import { resolveAreaClubYear } from "@/modules/club-reports/area-club-year";
import { rosterApiError } from "@/modules/club-rosters/api-errors";
import { parseCoordinatorRosterExportParams } from "@/modules/club-rosters/coordinator-export-columns";
import { runCoordinatorRosterExport } from "@/modules/club-rosters/coordinator-export";
import { currentAreaCoordinatorViewerActive } from "@/modules/organizations/area-coordinators";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

function notFound() {
  return Response.json({ message: "Not found." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
}

/**
 * Roster preview (`preview=1`, at most five rows) or CSV for an Area Coordinator (#1760). Gate first: anyone who is
 * not an active coordinator (or a staff act-as coordinator) gets 404. Columns come from the coordinator's own
 * allow-list, so a birth date, contact or unknown key is a 400. Every preview and download is audited by the module.
 */
async function getHandler(request: Request) {
  if (!(await currentAreaCoordinatorViewerActive())) return notFound();
  const viewer = await resolveAreaCoordinatorViewer();
  if (!viewer) return notFound();
  try {
    const url = new URL(request.url);
    const params = parseCoordinatorRosterExportParams(url.searchParams);
    const clubYear = resolveAreaClubYear(params.year);
    const result = await runCoordinatorRosterExport(
      { columns: params.columns, clubs: params.clubs, clubYear, preview: params.preview },
      viewer.actor.kind === "ATTENDEE" ? { accountId: viewer.actor.accountId } : { userId: viewer.actor.userId, actAsId: viewer.actor.actAsId },
    );
    if ("csv" in result) {
      return csvDownloadResponse(result.csv, exportFileName({ scope: clubYear, kind: "club-rosters" }));
    }
    return Response.json(
      { headers: result.headers, rows: result.rows, totalRows: result.totalRows },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return rosterApiError(error, "Building an Area Coordinator roster export");
  }
}

export const GET = withRequestContext(getHandler);
