import { requireClubsAdministration } from "@/modules/organizations/access";
import { honorApiError } from "@/modules/honors/api-errors";
import { honorCsvTemplate } from "@/modules/honors/catalog-csv";
import { withRequestContext } from "@/lib/request-context";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

/** The honor catalog CSV template (#385). */
async function getHandler() {
  try {
    await requireClubsAdministration();
    return csvDownloadResponse(honorCsvTemplate(), exportFileName({ scope: "honor-catalog", kind: "template" }));
  } catch (error) {
    return honorApiError(error, "Downloading the honor template");
  }
}

export const GET = withRequestContext(getHandler);
