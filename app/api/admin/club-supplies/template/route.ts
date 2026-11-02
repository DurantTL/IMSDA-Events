import { withRequestContext } from "@/lib/request-context";
import { clubSupplyApiError } from "@/modules/club-supplies/api-errors";
import { clubSupplyCsvTemplate } from "@/modules/club-supplies/catalog-csv";
import { requireClubsAdministration } from "@/modules/organizations/access";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

/** The club supply catalog CSV template (#531). */
async function getHandler() {
  try {
    await requireClubsAdministration();
    return csvDownloadResponse(clubSupplyCsvTemplate(), exportFileName({ scope: "club-supply-catalog", kind: "template" }));
  } catch (error) {
    return clubSupplyApiError(error, "Downloading the club supply template");
  }
}

export const GET = withRequestContext(getHandler);
