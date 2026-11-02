import { clubReportApiError } from "@/modules/club-reports/api-errors";
import { yearEndReportCsv } from "@/modules/club-reports/year-end-csv";
import { isReportYear, latestStartedReportYear } from "@/modules/club-reports/year-end-domain";
import { listYearEndReportsForYear } from "@/modules/club-reports/year-end-repository";
import { requireClubsAdministration } from "@/modules/organizations/access";
import { withRequestContext } from "@/lib/request-context";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

/** Every club's Year-End Report for a Pathfinder year, one row per club, as CSV (#607). Counts only. */
async function getHandler(request: Request) {
  try {
    await requireClubsAdministration();
    const requested = new URL(request.url).searchParams.get("year") ?? "";
    const reportYear = isReportYear(requested) ? requested : latestStartedReportYear(new Date());
    const csv = yearEndReportCsv(await listYearEndReportsForYear(reportYear));
    return csvDownloadResponse(csv, exportFileName({ scope: reportYear, kind: "year-end-reports" }));
  } catch (error) {
    return clubReportApiError(error, "Exporting year-end reports");
  }
}

export const GET = withRequestContext(getHandler);
