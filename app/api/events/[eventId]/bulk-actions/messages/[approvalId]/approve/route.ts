import { z } from "zod";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { messageApprovalApiError, messageApprovalViewerFor } from "@/modules/bulk-actions/message-http";
import { approveMessage } from "@/modules/bulk-actions/message-approvals";
import { withRequestContext } from "@/lib/request-context";

const approveSchema = z.strictObject({ previewFingerprint: z.string().trim().length(64, "Review the message again before approving it.") });

/**
 * Approve and send one queued message, with the fingerprint of the review the person just read. This is the only route that
 * turns a queued bulk message into a send. Communications access is checked again here.
 */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string; approvalId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, approvalId } = await context.params;
    const viewer = await messageApprovalViewerFor(eventId);
    const body = approveSchema.parse(await request.json());
    return Response.json({ approval: await approveMessage(viewer, approvalId, body.previewFingerprint) }, { status: 200 });
  } catch (error) {
    return messageApprovalApiError(error);
  }
}

export const POST = withRequestContext(postHandler);
