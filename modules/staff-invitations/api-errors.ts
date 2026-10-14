import { z } from "zod";
import { logError } from "@/lib/logger";
import { isSerializationFailure } from "@/lib/prisma-errors";
import { AccessDeniedError } from "@/modules/access/authorization";
import { StaffInvitationError, staffInvitationErrorStatus } from "@/modules/staff-invitations/repository";

const noStore = { "Cache-Control": "no-store" };

/**
 * The JSON every staff-invitation route answers with for a failure, staff or public. Never the request body: it holds names,
 * ages and email addresses.
 */
export function staffInvitationApiError(error: unknown, action: string) {
  if (error instanceof AccessDeniedError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof StaffInvitationError) {
    return Response.json({ error: error.code, message: error.message }, { status: staffInvitationErrorStatus(error.code), headers: noStore });
  }
  if (error instanceof z.ZodError) {
    return Response.json(
      { error: "INVALID_REQUEST", message: error.issues[0]?.message ?? "Review the details and try again.", field: error.issues[0]?.path.join(".") ?? null },
      { status: 400, headers: noStore },
    );
  }
  if (error instanceof SyntaxError) {
    return Response.json({ error: "INVALID_JSON", message: "The request is not valid JSON." }, { status: 400, headers: noStore });
  }
  if (isSerializationFailure(error)) {
    return Response.json({ error: "BUSY", message: "Another change landed at the same time. Nothing was saved. Try again." }, { status: 409, headers: noStore });
  }
  logError(`${action} failed`, error);
  return Response.json({ error: "REQUEST_FAILED", message: `${action} could not be completed.` }, { status: 500, headers: noStore });
}
