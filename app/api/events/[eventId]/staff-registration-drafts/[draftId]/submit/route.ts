import { z } from "zod";
import { effectivePermissions } from "@/modules/access/authorization";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { PublicRegistrationError } from "@/modules/forms/public-repository";
import { withRequestContext } from "@/lib/request-context";
import { authorizeStaffDrafts, staffDraftApiError } from "@/modules/staff-registration-drafts/api";
import { submitStaffDraft } from "@/modules/staff-registration-drafts/repository";
import { parseStaffSubmitBody } from "@/modules/staff-registration-drafts/schemas";

type Context = { params: Promise<{ eventId: string; draftId: string }> };

const headers = { "Cache-Control": "private, no-store" };
const maximumBodyBytes = 512 * 1024;

/** The same statuses the public registration route answers, plus `overridable` for a rule staff may go past with a reason. */
function registrationErrorResponse(error: PublicRegistrationError) {
  let status = 409;
  if (error.code === "FORM_NOT_FOUND") status = 404;
  if (error.code === "REGISTRATION_CLOSED") status = 410;
  if (error.code === "CLUB_ENTRY_REQUIRED") status = 403;
  if (error.code === "INVALID_SUBMISSION") status = 422;
  return Response.json({ error: error.code, message: error.message, issues: error.issues, overridable: error.overridable }, { status, headers });
}

/**
 * Staff send a registration they started, for the registrant (#1510). MANAGE_REGISTRATION on the event; an override also needs
 * OVERRIDE_REGISTRATION_RULES. The draft's source comes from the stored draft, never from the body.
 */
async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, draftId } = await context.params;
    const access = await authorizeStaffDrafts(eventId);
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maximumBodyBytes) {
      return Response.json({ error: "REQUEST_TOO_LARGE", message: "This registration request is too large." }, { status: 413, headers });
    }
    const body = parseStaffSubmitBody(JSON.parse(text));
    const canOverride = effectivePermissions(access.user, access.membership).includes("OVERRIDE_REGISTRATION_RULES");
    try {
      const confirmation = await submitStaffDraft(eventId, draftId, { userId: access.user.id, canOverride }, body);
      return Response.json({ confirmation }, { status: 201, headers });
    } catch (error) {
      if (error instanceof PublicRegistrationError) return registrationErrorResponse(error);
      throw error;
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "INVALID_REQUEST", message: error.issues[0]?.message ?? "The registration request is invalid.", issues: error.issues }, { status: 400, headers });
    }
    const response = staffDraftApiError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export const POST = withRequestContext(postHandler);
