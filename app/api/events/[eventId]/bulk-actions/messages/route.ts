import { messageApprovalApiError, messageApprovalViewerFor } from "@/modules/bulk-actions/message-http";
import { listMessageApprovals } from "@/modules/bulk-actions/message-approvals";
import { withRequestContext } from "@/lib/request-context";

/** The messages waiting for approval, and the last few decided. Needs communications access. */
async function getHandler(_request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    const viewer = await messageApprovalViewerFor(eventId);
    return Response.json(await listMessageApprovals(viewer), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return messageApprovalApiError(error);
  }
}

export const GET = withRequestContext(getHandler);
