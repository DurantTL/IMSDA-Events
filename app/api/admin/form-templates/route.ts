import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { formTemplateApiError, formTemplateDeniedMessage, formTemplateNoStore, readFormTemplateJson } from "@/modules/forms/form-template-api";
import { copyFormTemplate, listFormTemplateLibrary } from "@/modules/forms/form-template-library";
import { copyFormTemplateSchema } from "@/modules/forms/form-template-library-domain";
import { requireSystemAdministrator } from "@/modules/organizations/access";

/** System administrators read the form template library (#1064). Event staff pick templates through their own list. */
async function getHandler() {
  try {
    await requireSystemAdministrator(formTemplateDeniedMessage);
    return Response.json({ templates: await listFormTemplateLibrary() }, { headers: formTemplateNoStore });
  } catch (error) {
    return formTemplateApiError(error, "Listing form templates");
  }
}

/** A system administrator creates a template as a copy of another (#1064). Nothing that exists changes. */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const admin = await requireSystemAdministrator(formTemplateDeniedMessage);
    const input = copyFormTemplateSchema.parse(await readFormTemplateJson(request));
    return Response.json(await copyFormTemplate(input, admin.id), { status: 201, headers: formTemplateNoStore });
  } catch (error) {
    return formTemplateApiError(error, "Copying a form template");
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
