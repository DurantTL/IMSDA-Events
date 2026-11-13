import { AccessDeniedError, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { getServerEnv } from "@/lib/env";
import { findActiveMembership } from "@/modules/events/repository";
import { createPreviewLink, getActivePreviewLink, revokePreviewLink } from "@/modules/events/preview-link-repository";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ eventId: string }> };

const noStore = { "Cache-Control": "private, no-store" };

function failure(error: unknown, operation: string) {
  if (error instanceof AccessDeniedError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status });
  }
  logError(`${operation} failed`, error);
  return Response.json(
    { error: "EVENT_PREVIEW_LINK_FAILED", message: `${operation} could not be completed.` },
    { status: 500 },
  );
}

async function authorize(context: RouteContext) {
  const { eventId } = await context.params;
  const access = await requirePermission(await getCurrentSession(), eventId, "CONFIGURE_EVENT", findActiveMembership);
  return { eventId, userId: access.user.id };
}

/** Whether a preview link is active and when it ends. Never the link itself. */
async function getHandler(_request: Request, context: RouteContext) {
  try {
    const { eventId } = await authorize(context);
    const active = await getActivePreviewLink(eventId);
    return Response.json({ active: active !== null, expiresAt: active?.expiresAt ?? null }, { headers: noStore });
  } catch (error) {
    return failure(error, "Checking the preview link");
  }
}

/** Makes a new link (the old one stops working) and returns it once. */
async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, userId } = await authorize(context);
    const created = await createPreviewLink(eventId, userId);
    const url = new URL(`/event-preview/${created.token}`, getServerEnv().APP_BASE_URL).toString();
    return Response.json({ url, expiresAt: created.expiresAt }, { status: 201, headers: noStore });
  } catch (error) {
    return failure(error, "Making the preview link");
  }
}

/** Turns the active link off. */
async function deleteHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, userId } = await authorize(context);
    const revoked = await revokePreviewLink(eventId, userId);
    return Response.json({ active: false, revoked }, { headers: noStore });
  } catch (error) {
    return failure(error, "Turning off the preview link");
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
export const DELETE = withRequestContext(deleteHandler);
