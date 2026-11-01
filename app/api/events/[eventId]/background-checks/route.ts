import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { backgroundCheckApiError } from "@/modules/background-checks/api-errors";
import { backgroundFlagsCsv } from "@/modules/background-checks/domain";
import { listEventBackgroundFlags } from "@/modules/background-checks/repository";
import { withRequestContext } from "@/lib/request-context";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

/** Adults at a youth or children's event with no current Sterling Volunteers (#388), as CSV. */
async function getHandler(_request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "VIEW_REPORTS", findActiveMembership);
    const flags = await listEventBackgroundFlags(eventId, { includeContact: true });
    if (!flags) {
      return Response.json(
        { error: "BACKGROUND_CHECKS_OFF", message: "This event isn't marked as a youth or children's event." },
        { status: 404 },
      );
    }
    return csvDownloadResponse(backgroundFlagsCsv(flags.people), exportFileName({ scope: eventId, kind: "sterling-volunteers-needed" }));
  } catch (error) {
    return backgroundCheckApiError(error, "Downloading the Sterling Volunteers list");
  }
}

export const GET = withRequestContext(getHandler);
