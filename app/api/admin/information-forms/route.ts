import { withRequestContext } from "@/lib/request-context";
import { authorizeGeneralInformationForms } from "@/modules/information-forms/access";
import { informationFormHandlers } from "@/modules/information-forms/api";

const handlers = informationFormHandlers<Record<string, unknown>>(() => authorizeGeneralInformationForms());

export const GET = withRequestContext(async (request: Request) => handlers.list(request, {}));
export const POST = withRequestContext(async (request: Request) => handlers.create(request, {}));
