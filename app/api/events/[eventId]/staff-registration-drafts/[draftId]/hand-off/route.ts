import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { withRequestContext } from "@/lib/request-context";
import { authorizeStaffDrafts, staffDraftApiError } from "@/modules/staff-registration-drafts/api";
import { handOffStaffDraft } from "@/modules/staff-registration-drafts/repository";

type Context = { params: Promise<{ eventId: string; draftId: string }> };

/** Sends the registrant one private link, for this one draft. Never a batch. */
async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, draftId } = await context.params;
    const access = await authorizeStaffDrafts(eventId);
    return Response.json(await handOffStaffDraft(eventId, draftId, access.user.id), { status: 201 });
  } catch (error) {
    return staffDraftApiError(error);
  }
}

export const POST = withRequestContext(postHandler);
