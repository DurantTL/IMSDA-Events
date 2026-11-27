import { requireClubsAdministration } from "@/modules/organizations/access";
import { honorApiError } from "@/modules/honors/api-errors";
import { requirementCsvTemplate } from "@/modules/requirements/requirements-csv";
import { withRequestContext } from "@/lib/request-context";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

/** The honor requirements CSV template (#2054). */
async function getHandler() {
  try {
    await requireClubsAdministration();
    return csvDownloadResponse(requirementCsvTemplate(), exportFileName({ scope: "honor-requirements", kind: "template" }));
  } catch (error) {
    return honorApiError(error, "Downloading the honor requirements template");
  }
}

export const GET = withRequestContext(getHandler);
