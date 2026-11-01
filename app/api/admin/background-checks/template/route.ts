import { requireClubsAdministration } from "@/modules/organizations/access";
import { backgroundCheckApiError } from "@/modules/background-checks/api-errors";
import { rosterBackgroundCsvTemplate, sterlingCsvTemplate } from "@/modules/background-checks/domain";
import { withRequestContext } from "@/lib/request-context";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

/**
 * The Sterling Volunteers CSV template (#388, #427): the real roster export by
 * default, or the older Sterling Volunteers layout with `?format=sterling`.
 */
async function getHandler(request: Request) {
  try {
    await requireClubsAdministration();
    const sterling = new URL(request.url).searchParams.get("format") === "sterling";
    return csvDownloadResponse(sterling ? sterlingCsvTemplate() : rosterBackgroundCsvTemplate(), exportFileName({ scope: "sterling-volunteers", kind: sterling ? "export-template" : "roster-template" }), { bom: false });
  } catch (error) {
    return backgroundCheckApiError(error, "Downloading the Sterling Volunteers template");
  }
}

export const GET = withRequestContext(getHandler);
