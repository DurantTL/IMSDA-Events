import { z } from "zod";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { deleteSavedView, setSavedViewShared } from "@/modules/registrations/saved-views-repository";
import { savedViewApiError, savedViewViewerFor } from "@/modules/registrations/saved-views-http";
import { withRequestContext } from "@/lib/request-context";

const shareSchema = z.object({ shared: z.boolean() }).strict();

type RouteContext = { params: Promise<{ eventId: string; viewId: string }> };

async function patchHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, viewId } = await context.params;
    const viewer = await savedViewViewerFor(eventId);
    const input = shareSchema.parse(await request.json());
    return Response.json({ view: await setSavedViewShared(viewer, viewId, input.shared) });
  } catch (error) { return savedViewApiError(error); }
}

async function deleteHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, viewId } = await context.params;
    const viewer = await savedViewViewerFor(eventId);
    await deleteSavedView(viewer, viewId);
    return Response.json({ ok: true });
  } catch (error) { return savedViewApiError(error); }
}

export const PATCH = withRequestContext(patchHandler);
export const DELETE = withRequestContext(deleteHandler);
