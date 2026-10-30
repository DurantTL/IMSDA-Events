import { withRequestContext } from "@/lib/request-context";
import { requireEmergencyPlanAccess } from "@/modules/emergency-plans/access";
import { emergencyPlanApiError } from "@/modules/emergency-plans/api-errors";
import { getEmergencyPlanVersion } from "@/modules/emergency-plans/repository";
import { buildEmergencyReferenceSheet, emergencyReferenceCsv } from "@/modules/reporting/emergency-reference";

type RouteContext = { params: Promise<{ eventId: string }> };

/** The reference sheet of a published version as CSV (#114): `?version=N`, default the latest. VIEW_EVENT; reads only the snapshot. */
async function getHandler(request: Request, context: RouteContext) {
  try {
    const { eventId } = await context.params;
    await requireEmergencyPlanAccess(eventId, "VIEW_EVENT");
    const requested = new URL(request.url).searchParams.get("version");
    const versionNumber = requested === null ? undefined : Number(requested);
    if (versionNumber !== undefined && (!Number.isInteger(versionNumber) || versionNumber < 1)) {
      return Response.json({ error: "INVALID_VERSION", message: "Choose a published version number." }, { status: 400 });
    }
    const version = await getEmergencyPlanVersion(eventId, versionNumber);
    if (!version) {
      return Response.json({ error: "VERSION_NOT_FOUND", message: "There is no published emergency plan to export." }, { status: 404 });
    }
    const sheet = buildEmergencyReferenceSheet(version.snapshot, version);
    const safeEventId = eventId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100) || "event";
    return new Response(emergencyReferenceCsv(sheet), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeEventId}-emergency-plan-v${version.versionNumber}.csv"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return emergencyPlanApiError(error, "Exporting the emergency plan");
  }
}

export const GET = withRequestContext(getHandler);
