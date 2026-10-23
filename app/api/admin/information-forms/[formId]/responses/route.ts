import { withRequestContext } from "@/lib/request-context";
import { authorizeGeneralInformationForms } from "@/modules/information-forms/access";
import { informationFormHandlers } from "@/modules/information-forms/api";

const handlers = informationFormHandlers<Record<string, unknown>>(() => authorizeGeneralInformationForms());

export const GET = withRequestContext(async (request: Request, context: { params: Promise<{ formId: string }> }) => handlers.listResponses(request, await context.params));
