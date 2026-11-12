import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { inspectionImportSchema } from "@/modules/event-inspections/domain";
import { applyInspectionImport, previewInspectionImport } from "@/modules/event-inspections/service";
import { eventScoringApiError } from "@/modules/event-scoring/api-errors";
import { requireAreaCoordinatorScoringActor } from "@/modules/event-scoring/service";
import { withRequestContext } from "@/lib/request-context";

/** The inspection CSV import for an Area Coordinator (#1896): preview first, then apply with the preview's digest. */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireAreaCoordinatorScoringActor();
    const { eventId } = await context.params;
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
