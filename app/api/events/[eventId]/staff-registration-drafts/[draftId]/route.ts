import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { withRequestContext } from "@/lib/request-context";
import { authorizeStaffDrafts, staffDraftApiError } from "@/modules/staff-registration-drafts/api";
import { discardStaffDraft, getStaffDraft, updateStaffDraft } from "@/modules/staff-registration-drafts/repository";
import { updateStaffDraftSchema } from "@/modules/staff-registration-drafts/schemas";

type Context = { params: Promise<{ eventId: string; draftId: string }> };

async function getHandler(_request: Request, context: Context) {
  try {
    const { eventId, draftId } = await context.params;
    await authorizeStaffDrafts(eventId);
    return Response.json(await getStaffDraft(eventId, draftId));
  } catch (error) {
    return staffDraftApiError(error);
  }
}

async function patchHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, draftId } = await context.params;
    const access = await authorizeStaffDrafts(eventId);
    const input = updateStaffDraftSchema.parse(await request.json());
    return Response.json(await updateStaffDraft(eventId, draftId, access.user.id, input));
  } catch (error) {
    return staffDraftApiError(error);
  }
}

async function deleteHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, draftId } = await context.params;
    const access = await authorizeStaffDrafts(eventId);
    return Response.json(await discardStaffDraft(eventId, draftId, access.user.id));
  } catch (error) {
    return staffDraftApiError(error);
  }
}

export const GET = withRequestContext(getHandler);
export const PATCH = withRequestContext(patchHandler);
export const DELETE = withRequestContext(deleteHandler);
