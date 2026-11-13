import { z } from "zod";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { bulkActionApiError, bulkActionViewerFor } from "@/modules/bulk-actions/http";
import { confirmBulkAction } from "@/modules/bulk-actions/repository";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";
import { eventFileScope } from "@/modules/reporting/export-scope";
import { withRequestContext } from "@/lib/request-context";

const confirmSchema = z.strictObject({ idempotencyKey: z.string().max(200) });

/**
 * Explicit confirmation of a previewed run, with an idempotency key. The permissions are resolved again here. A tag action
 * answers with the summary as JSON. A first export answers with the CSV file itself (the counts are read from the run's
 * summary afterwards); a repeat of the same confirmation answers with the stored summary and no second file.
 */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string; runId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, runId } = await context.params;
    const viewer = await bulkActionViewerFor(eventId);
    const body = confirmSchema.parse(await request.json());
    const { summary, file } = await confirmBulkAction(viewer, runId, body.idempotencyKey);
    if (file) {
      const name = exportFileName({ scope: await eventFileScope(eventId), kind: "bulk-export" });
      return csvDownloadResponse(file.body, name, { headers: { "X-Bulk-Action-Run": summary.runId } });
    }
    return Response.json({ summary }, { status: 200 });
  } catch (error) {
    return bulkActionApiError(error);
  }
}

export const POST = withRequestContext(postHandler);
