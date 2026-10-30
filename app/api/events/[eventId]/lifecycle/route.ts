import { z } from "zod";
import { AccessDeniedError, effectivePermissions, requireEventMembership } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { EventLifecycleError, getEventLifecycle, transitionEventLifecycle } from "@/modules/events/lifecycle-repository";
import { eventLifecycleStates, LIFECYCLE_REASON_MAX_LENGTH } from "@/modules/events/lifecycle-state";
import { EventOperationError, findActiveMembership } from "@/modules/events/repository";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

const bodySchema = z.object({
  toState: z.enum(eventLifecycleStates),
  expectedFromState: z.enum(eventLifecycleStates),
  reason: z.string().max(LIFECYCLE_REASON_MAX_LENGTH).nullish(),
}).strict();

type RouteContext = { params: Promise<{ eventId: string }> };

function apiError(error: unknown) {
  if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
  if (error instanceof EventLifecycleError) {
    return Response.json(
      { error: `LIFECYCLE_${error.code}`, message: error.message, ...(error.currentState ? { currentState: error.currentState } : {}) },
      { status: error.code === "PERMISSION_DENIED" ? 403 : error.code === "REASON_TOO_LONG" ? 400 : 409 },
    );
  }
  if (error instanceof EventOperationError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.code === "EVENT_NOT_FOUND" ? 404 : 409 });
  }
  logError("Event lifecycle request failed", error);
  return Response.json({ error: "EVENT_LIFECYCLE_FAILED", message: "The event state could not be changed. Nothing was changed; try again." }, { status: 500 });
}

/** The caller's permissions for the event in the URL; membership is required, and each transition names the one it needs. */
async function actorFor(eventId: string) {
  const access = await requireEventMembership(await getCurrentSession(), eventId, findActiveMembership);
  return { userId: access.user.id, permissions: effectivePermissions(access.user, access.membership) };
}

async function getHandler(_request: Request, context: RouteContext) {
  try {
    const { eventId } = await context.params;
    const actor = await actorFor(eventId);
    const lifecycle = await getEventLifecycle({ eventId, permissions: actor.permissions });
    // The history carries actor ids and free-text reasons: only those who can change the state may read it.
    const mayReadHistory = actor.permissions.includes("CONFIGURE_EVENT") || actor.permissions.includes("MANAGE_FINANCE");
    return lifecycle
      ? Response.json({ lifecycle: mayReadHistory ? lifecycle : { ...lifecycle, history: [] } })
      : Response.json({ error: "EVENT_NOT_FOUND", message: "That event no longer exists." }, { status: 404 });
  } catch (error) { return apiError(error); }
}

async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const actor = await actorFor(eventId);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: "INVALID_REQUEST", message: "Send toState, expectedFromState and an optional reason of at most 500 characters." }, { status: 400 });
    }
    const result = await transitionEventLifecycle({ eventId, actor, ...parsed.data });
    const lifecycle = await getEventLifecycle({ eventId, permissions: actor.permissions });
    return Response.json({ changed: result.changed, lifecycle });
  } catch (error) { return apiError(error); }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
