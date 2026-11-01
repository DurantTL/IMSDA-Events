import { effectivePermissions, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { lodgingApiError } from "@/modules/lodging/api-errors";
import { lodgingRequestsCsv } from "@/modules/lodging/export";
import { getLodgingRequestExportRows } from "@/modules/lodging/preferences-service";
import { withRequestContext } from "@/lib/request-context";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

/**
 * Lodging requests for staff: approved fields only (confirmation code, type, nights, party size, private room,
 * household preference, roommate counts). No names, contact details, free text or restricted evidence. The two
 * accessibility columns exist only for staff who hold VIEW_SENSITIVE_DATA.
 */
async function getHandler(_request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "VIEW_REPORTS", findActiveMembership);
    const includeAccessibility = new Set(effectivePermissions(access.user, access.membership)).has("VIEW_SENSITIVE_DATA");
    return csvDownloadResponse(lodgingRequestsCsv(await getLodgingRequestExportRows(eventId), includeAccessibility), exportFileName({ scope: eventId, kind: "lodging-requests" }));
  } catch (error) {
    return lodgingApiError(error, "Exporting lodging requests");
  }
}

export const GET = withRequestContext(getHandler);
