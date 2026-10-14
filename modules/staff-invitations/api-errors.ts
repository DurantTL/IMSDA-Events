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
 * The request body as text, read in chunks and counted as it arrives, so a body that is over `maxBytes` is cancelled part way
 * (a chunked one with no Content-Length included) instead of being held whole. Returns null when it is over the cap.
 */
export async function readBoundedText(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** The request's JSON, read with `readBoundedText`. Call it after the permission check, never before. */
export async function readBoundedJson(request: Request, maxBytes = STAFF_BODY_MAX_BYTES): Promise<unknown> {
  const text = await readBoundedText(request, maxBytes);
  if (text === null) throw new StaffInvitationError("REQUEST_TOO_LARGE", "That request is too large.");
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
