import { z } from "zod";
import { AccessDeniedError, effectivePermissions, requireEventMembership } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { setAnnouncementEssential } from "@/modules/communications/announcement-essential";
import { findActiveMembership } from "@/modules/events/repository";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

const essentialSchema = z.strictObject({ essential: z.boolean() });

/**
 * Staff who hold MANAGE_COMMUNICATIONS (the permission that writes and sends announcements) or CONFIGURE_EVENT may
 * change the essential mark (#897); everyone else is refused.
 */
async function requireEssentialAccess(eventId: string) {
  const access = await requireEventMembership(await getCurrentSession(), eventId, findActiveMembership);
  const permissions = effectivePermissions(access.user, access.membership);
  if (permissions.includes("MANAGE_COMMUNICATIONS") || permissions.includes("CONFIGURE_EVENT")) return access;
  throw new AccessDeniedError(
    "The MANAGE_COMMUNICATIONS or CONFIGURE_EVENT permission is required to mark an announcement essential.",
    403,
    "PERMISSION_DENIED",
  );
}

/**
 * Mark an announcement essential so it reaches people who opted out (#838, #897). Audited with the actor.
 */
async function patchHandler(request: Request, context: { params: Promise<{ eventId: string; announcementId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, announcementId } = await context.params;
    const access = await requireEssentialAccess(eventId);
    const { essential } = essentialSchema.parse(await request.json());
    const result = await setAnnouncementEssential(eventId, announcementId, access.user.id, essential);
    if (!result) return Response.json({ error: "ANNOUNCEMENT_NOT_FOUND" }, { status: 404 });
    return Response.json({ announcement: { id: result.id, isEssential: result.isEssential } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "INVALID_ESSENTIAL_REQUEST", issues: error.issues }, { status: 400 });
    if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
    logError("Announcement essential request failed", error);
    return Response.json({ error: "ANNOUNCEMENT_ESSENTIAL_REQUEST_FAILED" }, { status: 500 });
  }
}

export const PATCH = withRequestContext(patchHandler);
