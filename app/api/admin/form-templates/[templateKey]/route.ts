import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { formTemplateApiError, formTemplateDeniedMessage, formTemplateNoStore, readFormTemplateJson } from "@/modules/forms/form-template-api";
import { getFormTemplateForEditor, saveFormTemplateVersion } from "@/modules/forms/form-template-library";
import { FormTemplateError, saveFormTemplateSchema } from "@/modules/forms/form-template-library-domain";
import { requireSystemAdministrator } from "@/modules/organizations/access";

type RouteContext = { params: Promise<{ templateKey: string }> };

/** A system administrator reads one template, with its definition and version history (#1064). */
async function getHandler(_request: Request, context: RouteContext) {
  try {
    await requireSystemAdministrator(formTemplateDeniedMessage);
    const { templateKey } = await context.params;
    const view = await getFormTemplateForEditor(templateKey);
    if (!view) throw new FormTemplateError("TEMPLATE_NOT_FOUND", "That form template was not found.");
    return Response.json({ template: view }, { headers: formTemplateNoStore });
  } catch (error) {
    return formTemplateApiError(error, "Reading a form template");
  }
}

/** A system administrator saves a new immutable version of a template (#1064). It names the version it started from. */
async function putHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const admin = await requireSystemAdministrator(formTemplateDeniedMessage);
    const { templateKey } = await context.params;
    const input = saveFormTemplateSchema.parse(await readFormTemplateJson(request));
    return Response.json(await saveFormTemplateVersion(templateKey, input, admin.id), { headers: formTemplateNoStore });
  } catch (error) {
    return formTemplateApiError(error, "Saving a form template");
  }
}

export const GET = withRequestContext(getHandler);
export const PUT = withRequestContext(putHandler);
