import { z } from "zod";
import { effectivePermissions, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { messagingApiError } from "@/modules/communications/api-errors";
import {
  activateScheduledEmail,
  cancelScheduledEmail,
  getScheduledEmail,
  pauseScheduledEmail,
  reviewStoredScheduledEmail,
} from "@/modules/communications/scheduled-email-repository";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ eventId: string; scheduleId: string }> };

async function authorize(eventId: string) {
  const access = await requirePermission(
    await getCurrentSession(),
    eventId,
    "MANAGE_COMMUNICATIONS",
    findActiveMembership,
  );
  return { access, permissions: effectivePermissions(access.user, access.membership) };
}

const requestSchema = z.object({ action: z.enum(["review", "activate", "pause", "cancel"]) }).loose();

async function getHandler(_request: Request, context: RouteContext) {
  try {
    const { eventId, scheduleId } = await context.params;
    await authorize(eventId);
    return Response.json({ schedule: await getScheduledEmail(eventId, scheduleId) });
  } catch (error) {
    return messagingApiError(error, "Loading the scheduled email");
  }
}

/**
 * `review` shows what approval would do now (projected time, daylight-saving note, eligible count, exclusions) and
 * writes nothing. `activate` is the approval: an authorized person's explicit request, with the fingerprint of the review
 * they saw. `pause` works only before a send has begun; `cancel` stops what has not been sent and keeps what has.
 */
async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, scheduleId } = await context.params;
    const { access, permissions } = await authorize(eventId);
    const { action, ...rest } = requestSchema.parse(await request.json());
    if (action === "review") {
      return Response.json({ review: await reviewStoredScheduledEmail(eventId, permissions, scheduleId) });
    }
    if (action === "activate") {
      const activated = await activateScheduledEmail(eventId, access.user.id, permissions, scheduleId, rest);
      return Response.json({ schedule: activated.schedule }, { status: activated.replayed ? 200 : 201 });
    }
    if (action === "pause") {
      return Response.json({ schedule: await pauseScheduledEmail(eventId, access.user.id, scheduleId) });
    }
    return Response.json({ schedule: await cancelScheduledEmail(eventId, access.user.id, scheduleId) });
  } catch (error) {
    return messagingApiError(error, "Updating the scheduled email");
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
