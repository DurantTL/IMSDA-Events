import { messageApprovalApiError, messageApprovalViewerFor } from "@/modules/bulk-actions/message-http";
import { getMessageApprovalReview } from "@/modules/bulk-actions/message-approvals";
import { withRequestContext } from "@/lib/request-context";

/** A fresh review of one queued message: counts, who is skipped and why, the text, and the fingerprint to approve with. */
async function getHandler(_request: Request, context: { params: Promise<{ eventId: string; approvalId: string }> }) {
  try {
    const { eventId, approvalId } = await context.params;
    const viewer = await messageApprovalViewerFor(eventId);
    return Response.json({ review: await getMessageApprovalReview(viewer, approvalId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return messageApprovalApiError(error);
  }
}

export const GET = withRequestContext(getHandler);
