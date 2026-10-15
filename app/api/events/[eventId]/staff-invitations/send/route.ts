import { z } from "zod";
import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { readBoundedJson, staffInvitationApiError } from "@/modules/staff-invitations/api-errors";
import { previewInvitationSend, sendInvitations } from "@/modules/staff-invitations/repository";
import { withRequestContext } from "@/lib/request-context";

type Context = { params: Promise<{ eventId: string }> };

const noStore = { "Cache-Control": "no-store" };

const ids = z.array(z.string().trim().min(1).max(64)).min(1).max(2000);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), ids }).strict(),
  /** `digest` is the one the preview gave for exactly which invitations would go; anything else sends nothing. */
  z.object({ action: z.literal("send"), ids, digest: z.string().regex(/^[0-9a-f]{32}$/) }).strict(),
]);

/**
 * Previewing and sending the invitation emails (#804). Sending is a bulk communication, so it needs MANAGE_COMMUNICATIONS
 * (checked before the body is read) and is always a person's explicit Send after a preview. It only queues the messages in
 * the event's outbox.
 */
async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_COMMUNICATIONS", findActiveMembership);
    const body = bodySchema.parse(await readBoundedJson(request));
    if (body.action === "preview") {
      return Response.json({ preview: await previewInvitationSend(eventId, body.ids) }, { headers: noStore });
    }
    return Response.json({ result: await sendInvitations(eventId, access.user.id, { ids: body.ids, digest: body.digest }) }, { headers: noStore });
  } catch (error) {
    return staffInvitationApiError(error, "Sending the staff invitations");
  }
}

export const POST = withRequestContext(postHandler);
