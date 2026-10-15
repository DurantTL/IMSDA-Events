import { AccessDeniedError, requireEventMembership } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { EventArchiveForbiddenError, unarchiveEvent } from "@/modules/events/archive-repository";
import { EventOperationError, findActiveMembership } from "@/modules/events/repository";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

function apiError(error: unknown) {
  if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
  if (error instanceof EventArchiveForbiddenError) return Response.json({ error: "EVENT_ARCHIVE_FORBIDDEN", message: error.message }, { status: 403 });
  if (error instanceof EventOperationError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.code === "EVENT_NOT_FOUND" ? 404 : 409 });
  }
  logError("Event unarchive failed", error);
  return Response.json({ error: "EVENT_ARCHIVE_FAILED", message: "The event could not be unarchived. Nothing was changed; try again." }, { status: 500 });
}

async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const access = await requireEventMembership(await getCurrentSession(), eventId, findActiveMembership);
    // Whether this actor may unarchive is decided inside the transaction, from their system role or active role on this event.
    const result = await unarchiveEvent({
      eventId,
      actor: { userId: access.user.id, globalRole: access.user.globalRole, eventRole: access.membership?.role ?? null },
    });
    return Response.json(result);
  } catch (error) { return apiError(error); }
}

export const POST = withRequestContext(postHandler);
