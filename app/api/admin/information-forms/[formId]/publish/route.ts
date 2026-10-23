import { withRequestContext } from "@/lib/request-context";
import { authorizeGeneralInformationForms } from "@/modules/information-forms/access";
import { informationFormHandlers } from "@/modules/information-forms/api";

const handlers = informationFormHandlers<Record<string, unknown>>(() => authorizeGeneralInformationForms());

export const POST = withRequestContext(async (request: Request, context: { params: Promise<{ formId: string }> }) => handlers.publish(request, await context.params));
