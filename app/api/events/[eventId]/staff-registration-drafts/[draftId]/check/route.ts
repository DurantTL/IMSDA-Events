import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { withRequestContext } from "@/lib/request-context";
import { authorizeStaffDrafts, staffDraftApiError } from "@/modules/staff-registration-drafts/api";
import { checkStaffDraft } from "@/modules/staff-registration-drafts/repository";

type Context = { params: Promise<{ eventId: string; draftId: string }> };

/** Runs the public form's checks on the saved draft and keeps nothing. */
async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, draftId } = await context.params;
    const access = await authorizeStaffDrafts(eventId);
    return Response.json({ result: await checkStaffDraft(eventId, draftId, access.user.id) });
  } catch (error) {
    return staffDraftApiError(error);
  }
}

export const POST = withRequestContext(postHandler);
