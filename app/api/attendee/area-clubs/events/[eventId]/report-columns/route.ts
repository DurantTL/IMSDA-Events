import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireCoordinatorClubEvent } from "@/modules/reporting/club-report-export";
import { clubReportApiError, handleClubReportRequest, resolveCoordinatorReportActor } from "@/modules/reporting/club-report-api";
import { withRequestContext } from "@/lib/request-context";

/**
 * An Area Coordinator's club event report (#1671): preview, print, CSV and saved layouts with the restricted column set
 * (names, age, role, class and the event flags; never dietary, medical, guardian contacts or birth dates). Only a
 * coordinator who passed the second sign-in step, and only a published club event; anyone else gets "not found".
 */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await resolveCoordinatorReportActor();
    if (!actor) return Response.json({ message: "Not found." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    const { eventId } = await context.params;
    await requireCoordinatorClubEvent(eventId);
    return await handleClubReportRequest({ eventId, viewer: { kind: "coordinator" }, actor, body: await request.json() });
  } catch (error) {
    return clubReportApiError(error, "Building the club report");
  }
}

export const POST = withRequestContext(postHandler);
