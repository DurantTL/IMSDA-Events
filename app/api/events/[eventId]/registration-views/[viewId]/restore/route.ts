import { z } from "zod";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { restoreSavedView } from "@/modules/registrations/saved-views-repository";
import { savedViewApiError, savedViewViewerFor } from "@/modules/registrations/saved-views-http";
import { withRequestContext } from "@/lib/request-context";

const restoreSchema = z.object({}).strict();

async function postHandler(request: Request, context: { params: Promise<{ eventId: string; viewId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, viewId } = await context.params;
    const viewer = await savedViewViewerFor(eventId);
    restoreSchema.parse(await request.json().catch(() => ({})));
    return Response.json({ view: await restoreSavedView(viewer, viewId) });
  } catch (error) { return savedViewApiError(error); }
}

export const POST = withRequestContext(postHandler);
