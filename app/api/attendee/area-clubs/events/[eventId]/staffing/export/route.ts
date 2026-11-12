import { assertStaffingAccess, requireAreaCoordinatorStaffingActor } from "@/modules/event-staffing/access";
import { staffingApiError } from "@/modules/event-staffing/api-errors";
import { buildStaffingExport } from "@/modules/event-staffing/repository";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";
import { withRequestContext } from "@/lib/request-context";

/**
 * The event staffing sheet as a CSV (#1678), for an Area Coordinator: activity, role and name, with no contact detail, age or
 * birth date. An active grant and the second sign-in step; the module must be on. The download is audited with counts only.
 */
async function getHandler(_request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const actor = await requireAreaCoordinatorStaffingActor();
    const { eventId } = await context.params;
    const event = await assertStaffingAccess(actor, eventId, "read");
    const { csv, slug } = await buildStaffingExport(actor, eventId, event.name);
    return csvDownloadResponse(csv, exportFileName({ scope: slug ?? eventId, kind: "event-staffing" }));
  } catch (error) {
    return staffingApiError(error, "Downloading the event staffing sheet");
  }
}

export const GET = withRequestContext(getHandler);
