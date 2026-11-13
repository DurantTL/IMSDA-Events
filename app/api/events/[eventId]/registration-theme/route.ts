import { z } from "zod";
import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { registrationThemeApiError } from "@/modules/registration-themes/api-errors";
import {
  discardRegistrationThemeDraft,
  getRegistrationThemeEditorState,
  publishRegistrationThemeDraft,
  revertRegistrationThemeToPlatformDefault,
  saveRegistrationThemeDraft,
} from "@/modules/registration-themes/repository";
import { registrationThemeTokensSchema } from "@/modules/registration-themes/tokens";
import { withRequestContext } from "@/lib/request-context";

type Context = { params: Promise<{ eventId: string }> };

const noStore = { "Cache-Control": "no-store" };

const saveBody = z.object({ tokens: registrationThemeTokensSchema }).strict();
const actionBody = z.object({ action: z.enum(["publish", "discard", "revert"]) }).strict();

/** The event's registration look for its editor (#283): the draft, the published version and the history. CONFIGURE_EVENT. */
async function getHandler(_request: Request, context: Context) {
  try {
    const { eventId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "CONFIGURE_EVENT", findActiveMembership);
    return Response.json({ theme: await getRegistrationThemeEditorState(eventId) }, { headers: noStore });
  } catch (error) {
    return registrationThemeApiError(error, "Loading the registration look");
  }
}

/** Saves the draft. The public form does not change until it is published. Audited. */
async function putHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "CONFIGURE_EVENT", findActiveMembership);
    const { tokens } = saveBody.parse(await request.json());
    return Response.json({ theme: await saveRegistrationThemeDraft(eventId, tokens, access.user.id) }, { headers: noStore });
  } catch (error) {
    return registrationThemeApiError(error, "Saving the registration look");
  }
}

/** Publishes the draft, discards it, or goes back to the platform look. Audited. */
async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "CONFIGURE_EVENT", findActiveMembership);
    const { action } = actionBody.parse(await request.json());
    const userId = access.user.id;
    const theme = action === "publish"
      ? await publishRegistrationThemeDraft(eventId, userId)
      : action === "discard"
        ? await discardRegistrationThemeDraft(eventId, userId)
        : await revertRegistrationThemeToPlatformDefault(eventId, userId);
    return Response.json({ theme }, { headers: noStore });
  } catch (error) {
    return registrationThemeApiError(error, "Changing the registration look");
  }
}

export const GET = withRequestContext(getHandler);
export const PUT = withRequestContext(putHandler);
export const POST = withRequestContext(postHandler);
