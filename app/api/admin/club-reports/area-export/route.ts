import { clubReportApiError } from "@/modules/club-reports/api-errors";
import { ALL_CLUB_KINDS } from "@/modules/organizations/area-coordinator-ministries-domain";
import { areaExportResponse } from "@/modules/club-reports/area-export";
import { requireClubsAdministration } from "@/modules/organizations/access";
import { withRequestContext } from "@/lib/request-context";

/** The same cross-club summary and points CSV for the conference office (#657). */
async function getHandler(request: Request) {
  try {
    await requireClubsAdministration();
    return await areaExportResponse(new URL(request.url), { kinds: ALL_CLUB_KINDS });
  } catch (error) {
    return clubReportApiError(error, "Exporting the club summary");
  }
}

export const GET = withRequestContext(getHandler);
