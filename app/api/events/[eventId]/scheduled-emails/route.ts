import { z } from "zod";
import { effectivePermissions, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { messagingApiError } from "@/modules/communications/api-errors";
import {
  createScheduledEmail,
  listScheduledEmails,
  previewScheduledEmail,
  updateScheduledEmail,
} from "@/modules/communications/scheduled-email-repository";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * Scheduled email batches (#177). Every route needs MANAGE_COMMUNICATIONS for this event, and the audience is built with
 * the caller's own permissions, exactly as the audience builder's. Nothing here approves or sends: saving writes a
 * SCHEDULED batch, and only the approval route of one batch makes it ACTIVE.
 */
async function authorize(eventId: string) {
  const access = await requirePermission(
    await getCurrentSession(),
    eventId,
    "MANAGE_COMMUNICATIONS",
    findActiveMembership,
  );
  return { access, permissions: effectivePermissions(access.user, access.membership) };
}

const requestSchema = z.object({ action: z.enum(["preview", "create", "update"]) }).loose();

async function getHandler(_request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    await authorize(eventId);
    return Response.json({ scheduledEmails: await listScheduledEmails(eventId) });
  } catch (error) {
    return messagingApiError(error, "Loading scheduled emails");
  }
}

async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const { access, permissions } = await authorize(eventId);
    const { action, ...rest } = requestSchema.parse(await request.json());
    if (action === "preview") {
      return Response.json({ review: await previewScheduledEmail(eventId, permissions, rest) });
    }
    if (action === "create") {
      const created = await createScheduledEmail(eventId, access.user.id, permissions, rest);
      return Response.json({ schedule: created.schedule }, { status: created.replayed ? 200 : 201 });
    }
    return Response.json({ schedule: await updateScheduledEmail(eventId, access.user.id, permissions, rest) });
  } catch (error) {
    return messagingApiError(error, "Saving the scheduled email");
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
