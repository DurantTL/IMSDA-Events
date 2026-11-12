import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { inspectionImportSchema } from "@/modules/event-inspections/domain";
import { applyInspectionImport, previewInspectionImport } from "@/modules/event-inspections/service";
import { eventScoringApiError } from "@/modules/event-scoring/api-errors";
import { requireStaffScoringAccess } from "@/modules/event-scoring/service";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * The inspection CSV import for staff (#1896): `preview` shows every row's result and changes nothing; `apply` writes the
 * matched rows only when it is sent the digest the preview returned for the same file.
 */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const actor = await requireStaffScoringAccess(await getCurrentSession(), eventId, findActiveMembership);
    const input = inspectionImportSchema.parse(await request.json());
    const body = input.action === "preview"
      ? { preview: await previewInspectionImport(actor, eventId, input.csv) }
      : { result: await applyInspectionImport(actor, eventId, input.csv, input.digest) };
    return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return eventScoringApiError(error, "Importing inspection scores");
  }
}

export const PUT = withRequestContext(putHandler);
