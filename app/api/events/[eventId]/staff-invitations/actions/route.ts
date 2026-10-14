import { z } from "zod";
import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { staffInvitationApiError } from "@/modules/staff-invitations/api-errors";
import { previewInvitationSend, revokeInvitations, sendInvitations } from "@/modules/staff-invitations/repository";
import { withRequestContext } from "@/lib/request-context";

type Context = { params: Promise<{ eventId: string }> };

const noStore = { "Cache-Control": "no-store" };

const ids = z.array(z.string().trim().min(1).max(64)).min(1).max(2000);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("revoke"), ids }).strict(),
  z.object({ action: z.literal("preview_send"), ids }).strict(),
  /** `expectedCount` is the number the preview promised; a different number sends nothing. */
  z.object({ action: z.literal("send"), ids, expectedCount: z.number().int().min(1).max(2000) }).strict(),
]);

/**
 * Bulk actions on the invite list (#804). Revoking needs MANAGE_REGISTRATION. Previewing and sending the emails need
 * MANAGE_COMMUNICATIONS: sending is a bulk communication, so it is always a person's explicit Send after a preview, and it only
 * queues the messages in the event's outbox.
 */
async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const body = bodySchema.parse(await request.json());
    const session = await getCurrentSession();
    if (body.action === "revoke") {
      const access = await requirePermission(session, eventId, "MANAGE_REGISTRATION", findActiveMembership);
      return Response.json({ result: await revokeInvitations(eventId, access.user.id, body.ids) }, { headers: noStore });
    }
    const access = await requirePermission(session, eventId, "MANAGE_COMMUNICATIONS", findActiveMembership);
    if (body.action === "preview_send") {
      return Response.json({ preview: await previewInvitationSend(eventId, body.ids) }, { headers: noStore });
    }
    return Response.json({ result: await sendInvitations(eventId, access.user.id, { ids: body.ids, expectedCount: body.expectedCount }) }, { headers: noStore });
  } catch (error) {
    return staffInvitationApiError(error, "Updating the staff invitations");
  }
}

export const POST = withRequestContext(postHandler);
