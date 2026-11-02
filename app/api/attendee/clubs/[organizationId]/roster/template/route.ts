import { requireRosterAccess } from "@/modules/club-rosters/access";
import { rosterApiError } from "@/modules/club-rosters/api-errors";
import { rosterCsvTemplate } from "@/modules/club-rosters/csv-import";
import { withRequestContext } from "@/lib/request-context";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

/** The roster CSV template (#384): column names only, nothing from the roster. */
async function getHandler(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const { organizationId } = await context.params;
    await requireRosterAccess(organizationId);
    return csvDownloadResponse(rosterCsvTemplate(), exportFileName({ scope: "club-roster", kind: "template" }));
  } catch (error) {
    return rosterApiError(error, "Downloading the roster template");
  }
}

export const GET = withRequestContext(getHandler);
