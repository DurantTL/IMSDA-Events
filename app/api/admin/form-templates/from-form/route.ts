import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { formTemplateApiError, formTemplateDeniedMessage, formTemplateNoStore, readFormTemplateJson } from "@/modules/forms/form-template-api";
import { saveFormAsTemplate } from "@/modules/forms/form-template-library";
import { saveFormAsTemplateSchema } from "@/modules/forms/form-template-library-domain";
import { requireSystemAdministrator } from "@/modules/organizations/access";

/**
 * A system administrator saves a registration form as a new template, or as a new version of an existing one (#1065).
 * The body names the form and the persisted version to snapshot, never a definition: only what is stored is saved.
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const admin = await requireSystemAdministrator(formTemplateDeniedMessage);
    const input = saveFormAsTemplateSchema.parse(await readFormTemplateJson(request));
    const result = await saveFormAsTemplate(input, admin.id);
    return Response.json(result, { status: result.created ? 201 : 200, headers: formTemplateNoStore });
  } catch (error) {
    return formTemplateApiError(error, "Saving a form as a template");
  }
}

export const POST = withRequestContext(postHandler);
