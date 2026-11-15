import { effectivePermissions, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { MessagingError } from "@/modules/communications/messaging-error";
import { findActiveMembership } from "@/modules/events/repository";
import { bulkActionApiError } from "@/modules/bulk-actions/http";
import type { ApprovalViewer } from "@/modules/bulk-actions/message-approvals";

/**
 * The signed-in person for one event, resolved fresh on every request, with communications access as the gate (the same
 * permission as sending to selected registrations). Approving also checks it again inside the service.
 */
export async function messageApprovalViewerFor(eventId: string): Promise<ApprovalViewer> {
  const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_COMMUNICATIONS", findActiveMembership);
  return { eventId, userId: access.user.id, permissions: effectivePermissions(access.user, access.membership) };
}

/**
 * Errors as responses. A send that was refused (the review changed, delivery is off) says why in the messaging module's own
 * words. Its details are left out: they carry the recipients, and a review here never shows an address or a name.
 */
export function messageApprovalApiError(error: unknown) {
  if (error instanceof MessagingError) {
    const status = error.code === "MESSAGE_NOT_FOUND" || error.code === "TEMPLATE_NOT_FOUND" ? 404 : 409;
    return Response.json({ error: error.code, message: error.message }, { status });
  }
  return bulkActionApiError(error);
}
