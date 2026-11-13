import { z } from "zod";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { bulkActionApiError, bulkActionViewerFor } from "@/modules/bulk-actions/http";
import { createBulkPreview } from "@/modules/bulk-actions/repository";
import { withRequestContext } from "@/lib/request-context";

// The action is a plain string on purpose: the framework refuses anything outside its list with a message that names the
// page to use, instead of a schema error.
const previewSchema = z.strictObject({
  action: z.string().max(100),
  params: z.unknown(),
  query: z.string().max(4000, "These filters are too long."),
  selectedIds: z.array(z.string().min(1).max(100)).max(5000).optional(),
});

/** Preview only: reads, records the reviewed scope and returns it. Nothing is changed until the run is confirmed. */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const viewer = await bulkActionViewerFor(eventId);
    const body = previewSchema.parse(await request.json());
    return Response.json({ preview: await createBulkPreview(viewer, body) }, { status: 201 });
  } catch (error) {
    return bulkActionApiError(error);
  }
}

export const POST = withRequestContext(postHandler);
