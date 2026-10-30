import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { eventTemplateApiError } from "@/modules/event-templates/api-errors";
import { requireEventTemplateManagementPermission } from "@/modules/event-templates/authorization";
import { previewTemplateFromEvent } from "@/modules/event-templates/from-event-repository";
import { withRequestContext } from "@/lib/request-context";

/** Previews saving one event as a template (#154): what would be copied and every exclusion. */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    requireEventTemplateManagementPermission(await getCurrentSession());
    const preview = await previewTemplateFromEvent(await request.json());
    return Response.json({ preview });
  } catch (error) {
    return eventTemplateApiError(error, {
      failureMessage: "The template preview could not be prepared.",
      logMessage: "Event template from-event preview failed",
      invalidInputCode: "INVALID_TEMPLATE_FROM_EVENT",
    });
  }
}

export const POST = withRequestContext(postHandler);
