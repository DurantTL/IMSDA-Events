import { ZodError } from "zod";
import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { resolveAreaCoordinatorViewer } from "@/modules/club-forms/access";
import { resolveAreaClubYear } from "@/modules/club-reports/area-club-year";
import { runRecordsExport } from "@/modules/club-reports/records-export";
import { parseRecordsExportBody } from "@/modules/club-reports/records-export-columns";
import { rosterApiError, readRosterJson } from "@/modules/club-rosters/api-errors";
import { currentAreaCoordinatorViewerActive } from "@/modules/organizations/area-coordinators";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

function notFound() {
  return Response.json({ message: "Not found." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
}

/**
 * POST only, same-origin: a download writes an audit entry, so no link can start it. Monthly Records preview
 * (`preview: true`, at most five rows) or CSV for an Area Coordinator (#1761). Gate first: anyone who is not an active
 * coordinator (or a staff act-as coordinator) gets 404. The body is strict: a closed column list, months inside the club
 * year, real clubs; anything else is a 400 and nothing is exported.
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  if (!(await currentAreaCoordinatorViewerActive())) return notFound();
  const viewer = await resolveAreaCoordinatorViewer();
  if (!viewer) return notFound();
  try {
    const params = parseRecordsExportBody(await readRosterJson(request));
    const clubYear = resolveAreaClubYear(params.year);
    const result = await runRecordsExport(
      { columns: params.columns, layout: params.layout, clubs: params.clubs, clubYear, months: params.months, preview: params.preview },
      viewer.actor.kind === "ATTENDEE" ? { accountId: viewer.actor.accountId } : { userId: viewer.actor.userId, actAsId: viewer.actor.actAsId },
    );
    if (result.csv !== null) {
      return csvDownloadResponse(result.csv, exportFileName({ scope: clubYear, kind: "club-monthly-records" }));
    }
    return Response.json(
      { headers: result.headers, rows: result.rows, totalRows: result.totalRows },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    // Records-specific code for a bad body; every other failure keeps the shared roster/export mapping.
    if (error instanceof ZodError) {
      return Response.json({ error: "INVALID_RECORDS_EXPORT_REQUEST", message: error.issues[0]?.message, issues: error.issues }, { status: 400 });
    }
    return rosterApiError(error, "Building an Area Coordinator Monthly Records export");
  }
}

export const POST = withRequestContext(postHandler);
