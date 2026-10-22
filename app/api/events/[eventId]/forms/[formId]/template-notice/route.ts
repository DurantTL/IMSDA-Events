import { z } from "zod";
import { AccessDeniedError, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { dismissTemplateNotice, FormOperationError } from "@/modules/forms/repository";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

const dismissSchema = z.object({ templateVersionId: z.string().trim().min(1).max(100) }).strict();

function apiError(error: unknown) {
  if (error instanceof SyntaxError) return Response.json({ error: "INVALID_JSON_BODY", message: "The request body must be valid JSON." }, { status: 400 });
  if (error instanceof z.ZodError) return Response.json({ error: "INVALID_FORM", message: error.issues[0]?.message }, { status: 400 });
  if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
  if (error instanceof FormOperationError) return Response.json({ error: error.code, message: error.message }, { status: error.code.endsWith("NOT_FOUND") ? 404 : 409 });
  logError("Registration form template notice dismissal failed", error);
  return Response.json({ error: "FORM_REQUEST_FAILED", message: "The notice could not be dismissed." }, { status: 500 });
}

/** Dismisses the "template changed" notice for one newer template version (#1065). It changes nothing about the form's content or its source. */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string; formId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, formId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_FORMS", findActiveMembership);
    const input = dismissSchema.parse(await request.json());
    return Response.json({ form: await dismissTemplateNotice(eventId, formId, access.user.id, input.templateVersionId) });
  } catch (error) { return apiError(error); }
}

export const POST = withRequestContext(postHandler);
