import { z } from "zod";
import { logError } from "@/lib/logger";
import { isSerializationFailure } from "@/lib/prisma-errors";
import { AccessDeniedError } from "@/modules/access/authorization";
import { StaffInvitationError, staffInvitationErrorStatus } from "@/modules/staff-invitations/repository";

const noStore = { "Cache-Control": "no-store" };

/** The most a staff route reads from a request body (the import takes a whole CSV). */
export const STAFF_BODY_MAX_BYTES = 128 * 1024;
export const IMPORT_BODY_MAX_BYTES = 1024 * 1024;

/**
 * The request's JSON, read only up to `maxBytes`: a declared length over the cap is refused without reading, and so is a body
 * that turns out larger. Call it after the permission check, never before.
 */
export async function readBoundedJson(request: Request, maxBytes = STAFF_BODY_MAX_BYTES): Promise<unknown> {
  const tooLarge = () => new StaffInvitationError("REQUEST_TOO_LARGE", "That request is too large.");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  const text = await request.text();
  if (Buffer.byteLength(text) > maxBytes) throw tooLarge();
  return JSON.parse(text);
}

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
