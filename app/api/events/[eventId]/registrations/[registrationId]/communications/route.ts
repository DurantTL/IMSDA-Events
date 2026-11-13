import { AccessDeniedError, effectivePermissions, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { loadRegistrationTimeline } from "@/modules/communications/timeline-repository";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

/**
 * The communication timeline of one registration (#179), read only. It needs the same permission as the registration
 * detail. The viewer's event permissions are worked out here from the session and decide, on the server, whether a
 * health-related message keeps its subject and text. Never cached.
 */
async function getHandler(_request: Request, context: { params: Promise<{ eventId: string; registrationId: string }> }) {
  try {
    const { eventId, registrationId } = await context.params;
    const { user, membership } = await requirePermission(await getCurrentSession(), eventId, "VIEW_SENSITIVE_DATA", findActiveMembership);
    const timeline = await loadRegistrationTimeline({ eventId, registrationId, permissions: effectivePermissions(user, membership) });
    if (!timeline) return Response.json({ error: "REGISTRATION_NOT_FOUND", message: "That registration was not found for this event." }, { status: 404 });
    return Response.json(timeline, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
    logError("Registration timeline request failed", error);
    return Response.json({ error: "TIMELINE_REQUEST_FAILED", message: "The email history could not be loaded." }, { status: 500 });
  }
}

export const GET = withRequestContext(getHandler);
