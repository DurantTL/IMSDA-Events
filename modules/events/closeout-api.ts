import "server-only";

import { AccessDeniedError, effectivePermissions, requireEventMembership } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { CloseoutError } from "@/modules/events/closeout-repository";
import { EventLifecycleError } from "@/modules/events/lifecycle-repository";
import { EventOperationError, findActiveMembership } from "@/modules/events/repository";
import { logError } from "@/lib/logger";

/** Shared by the closeout routes (#1515): the caller's permissions, and one mapping from typed refusals to responses. */
export const closeoutHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function closeoutActor(eventId: string) {
  const access = await requireEventMembership(await getCurrentSession(), eventId, findActiveMembership);
  return { userId: access.user.id, permissions: effectivePermissions(access.user, access.membership) };
}

const closeoutStatus: Record<CloseoutError["code"], number> = {
  BLOCKING_CHECKS: 409,
  WARNINGS_NOT_ACKNOWLEDGED: 409,
  STALE_VERSION: 409,
  ALREADY_DONE: 409,
  NOTE_TOO_LONG: 400,
  REASON_REQUIRED: 400,
  REASON_TOO_LONG: 400,
  NOT_FOUND: 404,
};

export function closeoutApiError(error: unknown) {
  if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: closeoutHeaders });
  if (error instanceof CloseoutError) {
    return Response.json({ error: `CLOSEOUT_${error.code}`, message: error.message, ...(error.currentState ? { currentState: error.currentState } : {}) }, { status: closeoutStatus[error.code], headers: closeoutHeaders });
  }
  if (error instanceof EventLifecycleError) {
    return Response.json(
      { error: `LIFECYCLE_${error.code}`, message: error.message, ...(error.currentState ? { currentState: error.currentState } : {}) },
      { status: error.code === "PERMISSION_DENIED" ? 403 : error.code === "REASON_TOO_LONG" ? 400 : 409, headers: closeoutHeaders },
    );
  }
  if (error instanceof EventOperationError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.code === "EVENT_NOT_FOUND" ? 404 : 409, headers: closeoutHeaders });
  }
  logError("Event closeout request failed", error);
  return Response.json({ error: "EVENT_CLOSEOUT_FAILED", message: "The closeout could not be saved. Nothing was changed; try again." }, { status: 500, headers: closeoutHeaders });
}
