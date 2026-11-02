import { withRequestContext } from "@/lib/request-context";
import { orderEverythingCsv, orderListCsv, pickListCsv } from "@/modules/club-orders/domain";
import { clubOrderApiError } from "@/modules/club-orders/api-errors";
import { listHelperLines, listPickList, loadOrderExportHeader } from "@/modules/club-orders/repository";
import { requireClubOrdersAccess } from "@/modules/club-supplies/access";
import { syncHonorOrderNeeds } from "@/modules/honors/order-source";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

type RouteContext = { params: Promise<{ organizationId: string }> };

function csvResponse(body: string, organizationId: string, kind: string) {
  return csvDownloadResponse(body, exportFileName({ scope: organizationId, kind }));
}

/**
 * The order screen's exports (#487, #654): `view=list` is the helper list
 * (club, church, director contact, date, then every line grouped by section
 * with item name, size, item number and quantity); `view=picklist` is the
 * per-member pick list; `view=all` is one combined table (honors, uniforms and
 * other items, one row per item). The list is read from what's saved, so the file
 * matches the screen. Only an editor's download syncs new needs first; a
 * view-only role exports what's on file.
 */
async function getHandler(request: Request, context: RouteContext) {
  try {
    const { organizationId } = await context.params;
    const access = await requireClubOrdersAccess(organizationId);
    const view = new URL(request.url).searchParams.get("view");
    if (view !== "list" && view !== "picklist" && view !== "all") {
      return Response.json({ error: "INVALID_VIEW", message: "Choose list, all or picklist." }, { status: 400 });
    }
    if (access.mode === "EDIT") await syncHonorOrderNeeds(organizationId);
    if (view === "picklist") {
      return csvResponse(pickListCsv(await listPickList(organizationId)), organizationId, "pick-list");
    }
    if (view === "all") {
      return csvResponse(orderEverythingCsv(await listHelperLines(organizationId)), organizationId, "order-everything");
    }
    const [header, lines] = await Promise.all([loadOrderExportHeader(organizationId), listHelperLines(organizationId)]);
    return csvResponse(orderListCsv(header, lines), organizationId, "order-list");
  } catch (error) {
    return clubOrderApiError(error, "Exporting the order list");
  }
}

export const GET = withRequestContext(getHandler);
