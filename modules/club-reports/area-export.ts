import "server-only";

import { areaPointsCsv, areaSummaryCsv } from "@/modules/club-reports/area-summary-domain";
import { getAreaClubsSummary } from "@/modules/club-reports/area-summary-repository";
import { resolveAreaClubYear } from "@/modules/club-reports/area-club-year";
import type { ClubKindValue } from "@/modules/organizations/club-kind";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

// The coordinator's `?year=` rule lives in a client-safe file so the banner's year box can use it too (#1555).
export { resolveAreaClubYear };

/** The CSV download for the coordinator's and the office's cross-club views. Authorize before calling. A coordinator passes their ministries (#843); the office leaves `kinds` out. */
export async function areaExportResponse(url: URL, options: { kinds?: readonly ClubKindValue[] } = {}) {
  const clubYear = resolveAreaClubYear(url.searchParams.get("year") ?? undefined);
  const report = url.searchParams.get("report") === "points" ? "points" : "summary";
  const clubs = await getAreaClubsSummary(clubYear, new Date(), { backgroundChecks: false, ...(options.kinds ? { kinds: options.kinds } : {}) });
  const csv = report === "points" ? areaPointsCsv(clubYear, clubs) : areaSummaryCsv(clubYear, clubs);
  return csvDownloadResponse(csv, exportFileName({ scope: clubYear, kind: `club-${report}` }));
}
