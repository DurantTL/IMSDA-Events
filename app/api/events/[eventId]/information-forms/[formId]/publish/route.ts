import { withRequestContext } from "@/lib/request-context";
import { authorizeEventInformationForms } from "@/modules/information-forms/access";
import { informationFormHandlers } from "@/modules/information-forms/api";

const handlers = informationFormHandlers<{ eventId: string }>(authorizeEventInformationForms);

export const POST = withRequestContext(async (request: Request, context: { params: Promise<{ eventId: string; formId: string }> }) => handlers.publish(request, await context.params));
