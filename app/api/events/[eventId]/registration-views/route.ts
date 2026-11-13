import { z } from "zod";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { createSavedView } from "@/modules/registrations/saved-views-repository";
import { savedViewApiError, savedViewViewerFor } from "@/modules/registrations/saved-views-http";
import { withRequestContext } from "@/lib/request-context";

const createSchema = z.object({
  name: z.string().max(200, "Use 60 characters or fewer for the name."),
  query: z.string().max(4000, "These filters are too long to save."),
  shared: z.boolean().optional(),
}).strict();

async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const viewer = await savedViewViewerFor(eventId);
    const input = createSchema.parse(await request.json());
    return Response.json({ view: await createSavedView(viewer, input) }, { status: 201 });
  } catch (error) { return savedViewApiError(error); }
}

export const POST = withRequestContext(postHandler);
