import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { withRequestContext } from "@/lib/request-context";
import { authorizeStaffDrafts, staffDraftApiError } from "@/modules/staff-registration-drafts/api";
import { createStaffDraft, listStartableForms, listStaffDrafts } from "@/modules/staff-registration-drafts/repository";
import { createStaffDraftSchema } from "@/modules/staff-registration-drafts/schemas";

type Context = { params: Promise<{ eventId: string }> };

async function getHandler(_request: Request, context: Context) {
  try {
    const { eventId } = await context.params;
    await authorizeStaffDrafts(eventId);
    const [drafts, forms] = await Promise.all([listStaffDrafts(eventId), listStartableForms(eventId)]);
    return Response.json({ drafts, forms });
  } catch (error) {
    return staffDraftApiError(error);
  }
}

async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const access = await authorizeStaffDrafts(eventId);
    const input = createStaffDraftSchema.parse(await request.json());
    return Response.json({ draft: await createStaffDraft(eventId, access.user.id, input) }, { status: 201 });
  } catch (error) {
    return staffDraftApiError(error);
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
