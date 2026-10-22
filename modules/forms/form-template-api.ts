import { ZodError } from "zod";
import { logError } from "@/lib/logger";
import { AccessDeniedError } from "@/modules/access/authorization";
import { FormTemplateError } from "@/modules/forms/form-template-library-domain";
import { readRosterJson, RosterBodyError } from "@/modules/club-rosters/api-errors";

export { readRosterJson as readFormTemplateJson };

const statusByCode: Record<FormTemplateError["code"], number> = {
  TEMPLATE_NOT_FOUND: 404,
  TEMPLATE_UNREADABLE: 409,
  VERSION_CONFLICT: 409,
  TEMPLATE_BUSY: 503,
  INVALID_TEMPLATE: 400,
  FORM_NOT_FOUND: 404,
};

export const formTemplateDeniedMessage = "System administrator access is required to manage form templates.";
export const formTemplateNoStore = { "Cache-Control": "private, no-store, max-age=0" };

/**
 * One error mapper for the form template routes (#1064). It never logs or echoes a
 * request body: an error carries a code and a fixed message only.
 */
export function formTemplateApiError(error: unknown, action: string) {
  if (error instanceof ZodError) {
    return Response.json({ error: "INVALID_FORM_TEMPLATE_REQUEST", message: error.issues[0]?.message ?? "Check the template and try again." }, { status: 400 });
  }
  if (error instanceof RosterBodyError) return Response.json({ error: error.code, message: error.message }, { status: 400 });
  if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
  if (error instanceof FormTemplateError) {
    return Response.json({ error: error.code, message: error.message }, { status: statusByCode[error.code], headers: formTemplateNoStore });
  }
  logError(action, error);
  return Response.json({ error: "FORM_TEMPLATE_REQUEST_FAILED", message: "The form template request could not be completed." }, { status: 500 });
}
