import { AccessDeniedError } from "@/modules/access/authorization";
import { isSerializationFailure } from "@/lib/prisma-errors";
import { clubRegistrationApiError } from "@/modules/club-registrations/api-errors";
import { GeneralLinkError, generalLinkErrorStatus } from "@/modules/general-link-registrations/repository";

const noStore = { "Cache-Control": "no-store" };

/**
 * The JSON a general-link route answers with for any failure, public or staff. The club module's mapping covers the shared
 * refusals (team rules, locations, the form's own issues, a busy database); the link's own and staff access are answered here.
 * Never the request body, which holds the names and ages of minors.
 */
export function generalLinkApiError(error: unknown, action: string) {
  if (error instanceof AccessDeniedError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof GeneralLinkError) {
    return Response.json({ error: error.code, message: error.message }, { status: generalLinkErrorStatus(error.code), headers: noStore });
  }
  // A race that outlasted its retries: nothing was saved, and a second try will go through.
  if (isSerializationFailure(error)) {
    return Response.json({ error: "GENERAL_LINK_CONFLICT", message: "Another change landed at the same time. Refresh and try again." }, { status: 409, headers: noStore });
  }
  return clubRegistrationApiError(error, action);
}
