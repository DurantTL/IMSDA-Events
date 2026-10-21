import { AccessDeniedError } from "@/modules/access/authorization";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireHonorPermission } from "@/modules/honors/access";
import { HonorWatchError, getHonorWatchPanel, replaceHonorWatches } from "@/modules/honors/watch-repository";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ eventId: string }> };

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

function apiError(error: unknown) {
  if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
  if (error instanceof HonorWatchError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.code === "EVENT_NOT_FOUND" ? 404 : 400 });
  }
  logError("Honor watches request failed", error);
  return Response.json({ error: "HONOR_WATCHES_FAILED", message: "The honor watches could not be saved. Try again." }, { status: 500 });
}

/**
 * An event's honor watches (#1099). Event administrators and system administrators only (CONFIGURE_EVENT; a system
 * administrator passes every event check), because the list decides who is emailed which youth joined or left a class.
 */
async function getHandler(_request: Request, context: RouteContext) {
  try {
    const { eventId } = await context.params;
    await requireHonorPermission(eventId, "CONFIGURE_EVENT");
    return Response.json(await getHonorWatchPanel(eventId), { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}

async function putHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const access = await requireHonorPermission(eventId, "CONFIGURE_EVENT");
    const body = await request.json().catch(() => null);
    return Response.json(await replaceHonorWatches(eventId, access.user.id, body), { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withRequestContext(getHandler);
export const PUT = withRequestContext(putHandler);
