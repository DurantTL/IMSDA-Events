import { assetApiError, assetJson, requireAnyAssetPermission } from "@/modules/issued-assets/api";
import { closeoutCsv, closeoutSections, getCloseoutReport, type CloseoutSection } from "@/modules/issued-assets/closeout";
import { withRequestContext } from "@/lib/request-context";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";
import { eventFileScope } from "@/modules/reporting/export-scope";

/**
 * The issued-asset closeout (#214): `?section=outstanding|lost|damaged|charges|deposits|facility|exceptions|summary&format=csv`
 * downloads one section as a formula-safe CSV; without `format` it returns the whole report as JSON. Reading only:
 * check-in staff, finance, event administrators and report viewers.
 */
async function getHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    await requireAnyAssetPermission(eventId, ["MANAGE_CHECK_IN", "MANAGE_FINANCE", "CONFIGURE_EVENT", "VIEW_REPORTS"]);
    const url = new URL(request.url);
    const report = await getCloseoutReport(eventId);
    if (url.searchParams.get("format") !== "csv") return assetJson(report);
    const section = url.searchParams.get("section") ?? "exceptions";
    if (!(closeoutSections as readonly string[]).includes(section)) return assetJson({ error: "INVALID_ASSET_INPUT", message: "Choose a section to download." }, 400);
    return csvDownloadResponse(closeoutCsv(report, section as CloseoutSection), exportFileName({ scope: await eventFileScope(eventId), kind: `asset-closeout-${section}` }));
  } catch (error) {
    return assetApiError(error, "The closeout report");
  }
}

export const GET = withRequestContext(getHandler);
