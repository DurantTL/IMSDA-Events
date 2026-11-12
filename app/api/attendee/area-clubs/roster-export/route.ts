import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { actAsRoleMarks } from "@/modules/audit/act-as-actor-role";
import { resolveAreaCoordinatorViewer } from "@/modules/club-forms/access";
import { resolveAreaClubYear } from "@/modules/club-reports/area-club-year";
import { rosterApiError, readRosterJson } from "@/modules/club-rosters/api-errors";
import { parseCoordinatorRosterExportBody } from "@/modules/club-rosters/coordinator-export-columns";
import { runCoordinatorRosterExport } from "@/modules/club-rosters/coordinator-export";
import { currentAreaCoordinatorClubKinds } from "@/modules/organizations/area-coordinators";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

function notFound() {
  return Response.json({ message: "Not found." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
}

/**
 * POST only, same-origin (like the director's export #490): a download writes an audit entry, so no link can start it.
 * Roster preview (`preview: true`, at most five rows) or CSV for an Area Coordinator (#1760). Gate first: anyone who is
 * not an active coordinator (or a staff act-as coordinator) gets 404. Columns come from the coordinator's own
 * allow-list, so a birth date, contact or unknown key is a 400. Every preview and download is audited by the module.
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  const kinds = await currentAreaCoordinatorClubKinds();
  if (!kinds) return notFound();
  const viewer = await resolveAreaCoordinatorViewer();
  if (!viewer) return notFound();
  try {
    const params = parseCoordinatorRosterExportBody(await readRosterJson(request));
    const clubYear = resolveAreaClubYear(params.year);
    const result = await runCoordinatorRosterExport(
      { columns: params.columns, clubs: params.clubs, clubYear, preview: params.preview, kinds },
      viewer.actor.kind === "ATTENDEE" ? { accountId: viewer.actor.accountId } : { userId: viewer.actor.userId, actAsId: viewer.actor.actAsId, ...actAsRoleMarks(viewer.actor) },
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

export const POST = withRequestContext(postHandler);
