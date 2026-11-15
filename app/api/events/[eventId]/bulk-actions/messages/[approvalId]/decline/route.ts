import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { messageApprovalApiError, messageApprovalViewerFor } from "@/modules/bulk-actions/message-http";
import { declineMessage } from "@/modules/bulk-actions/message-approvals";
import { withRequestContext } from "@/lib/request-context";

/** Decline a queued message. It is never sent. */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string; approvalId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, approvalId } = await context.params;
    const viewer = await messageApprovalViewerFor(eventId);
    return Response.json({ approval: await declineMessage(viewer, approvalId) }, { status: 200 });
  } catch (error) {
    return messageApprovalApiError(error);
  }
}

export const POST = withRequestContext(postHandler);
