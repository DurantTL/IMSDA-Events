import { requireSystemAdministrator } from "@/modules/organizations/access";
import { areaCoordinatorCsvTemplate } from "@/modules/organizations/area-coordinator-import-domain";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";
import { userAdminApiError } from "@/modules/system-admin/user-admin-api";
import { withRequestContext } from "@/lib/request-context";

/** The Area Coordinator CSV template (#1608): column names only. */
async function getHandler() {
  try {
    await requireSystemAdministrator("System administrator access is required to import Area Coordinators.");
    return csvDownloadResponse(areaCoordinatorCsvTemplate(), exportFileName({ scope: "area-coordinators", kind: "template" }));
  } catch (error) {
    return userAdminApiError(error, "Downloading the Area Coordinator template");
  }
}

export const GET = withRequestContext(getHandler);
