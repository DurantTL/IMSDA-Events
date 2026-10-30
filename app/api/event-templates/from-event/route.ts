import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { eventTemplateApiError } from "@/modules/event-templates/api-errors";
import { requireEventTemplateManagementPermission } from "@/modules/event-templates/authorization";
import { saveTemplateFromEvent } from "@/modules/event-templates/from-event-repository";
import { withRequestContext } from "@/lib/request-context";

/** Saves a reviewed event as a new template or a new draft version (#154): 201 when saved, 200 for an idempotent retry. */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const user = requireEventTemplateManagementPermission(await getCurrentSession());
    const result = await saveTemplateFromEvent(user.id, await request.json());
    return Response.json(
      { template: result.template, versionId: result.versionId, versionNumber: result.versionNumber, alreadySaved: result.alreadySaved },
      { status: result.alreadySaved ? 200 : 201 },
    );
  } catch (error) {
    return eventTemplateApiError(error, {
      failureMessage: "The event could not be saved as a template.",
      logMessage: "Event template from-event save failed",
      invalidInputCode: "INVALID_TEMPLATE_FROM_EVENT",
    });
  }
}

export const POST = withRequestContext(postHandler);
