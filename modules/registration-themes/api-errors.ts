import { AccessDeniedError } from "@/modules/access/authorization";
import { clubRegistrationApiError } from "@/modules/club-registrations/api-errors";
import { isThemeWriteConflict, RegistrationThemeError, registrationThemeErrorStatus } from "./repository";

const noStore = { "Cache-Control": "no-store" };

/**
 * The JSON a registration-theme route answers with for any failure. A publish refused for contrast names each failing pair.
 * Anything else (a bad body, a busy database) goes through the shared mapping.
 */
export function registrationThemeApiError(error: unknown, action: string) {
  if (error instanceof AccessDeniedError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof RegistrationThemeError) {
    const failing = error.report?.failing.map((check) => ({ id: check.id, label: check.label, ratio: check.ratio, minimum: check.minimum }));
    return Response.json({ error: error.code, message: error.message, ...(failing ? { failing } : {}) }, { status: registrationThemeErrorStatus(error.code), headers: noStore });
  }
  // A collision or the database refusing to change a published look, if one slipped past the repository's own mapping.
  if (isThemeWriteConflict(error)) {
    return Response.json({ error: "CONFLICT", message: "Someone else changed this look at the same time. Refresh and try again." }, { status: 409, headers: noStore });
  }
  return clubRegistrationApiError(error, action);
}
