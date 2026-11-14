import { bulkActionApiError, bulkActionViewerFor } from "@/modules/bulk-actions/http";
import { getBulkSummary } from "@/modules/bulk-actions/repository";
import { withRequestContext } from "@/lib/request-context";

/** The stored result of one run, for the person who ran it. Counts and confirmation codes only. */
async function getHandler(_request: Request, context: { params: Promise<{ eventId: string; runId: string }> }) {
  try {
    const { eventId, runId } = await context.params;
    const viewer = await bulkActionViewerFor(eventId);
    return Response.json({ summary: await getBulkSummary(viewer, runId) });
  } catch (error) {
    return bulkActionApiError(error);
  }
}

export const GET = withRequestContext(getHandler);
