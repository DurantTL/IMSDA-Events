import { Prisma } from "@prisma/client";
import { z } from "zod";
import { AccessDeniedError } from "@/modules/access/authorization";
import { logError } from "@/lib/logger";
import { AcknowledgmentError, type AcknowledgmentErrorCode } from "@/modules/acknowledgments/repository";

/** SQLSTATE the acknowledgment evidence triggers raise (append-only, wrong-event references). */
export const ACKNOWLEDGMENT_TRIGGER_SQLSTATE = "AE001";

function isAcknowledgmentTriggerError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError) {
    return error.message.includes(ACKNOWLEDGMENT_TRIGGER_SQLSTATE) || (error as { meta?: { code?: string } }).meta?.code === ACKNOWLEDGMENT_TRIGGER_SQLSTATE;
  }
  return false;
}

const notFound = new Set<AcknowledgmentErrorCode>(["REGISTRATION_NOT_FOUND", "FIELD_NOT_FOUND", "ATTENDEE_NOT_FOUND", "EVIDENCE_NOT_FOUND", "ACTOR_NOT_FOUND"]);
const badRequest = new Set<AcknowledgmentErrorCode>(["ATTENDEE_REQUIRED", "ATTENDEE_NOT_ALLOWED", "ACKNOWLEDGED_AT_INVALID"]);
const forbidden = new Set<AcknowledgmentErrorCode>(["ACTING_FOR_MINOR_NOT_AUTHORIZED", "ACTING_FOR_ANOTHER_NOT_AUTHORIZED"]);

export function acknowledgmentApiError(error: unknown) {
  if (error instanceof z.ZodError) {
    return Response.json({ error: "INVALID_ACKNOWLEDGMENT_REQUEST", message: error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
  }
  if (error instanceof SyntaxError) {
    return Response.json({ error: "INVALID_ACKNOWLEDGMENT_REQUEST", message: "The request body must be JSON." }, { status: 400 });
  }
  if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
  if (error instanceof AcknowledgmentError) {
    const status = notFound.has(error.code) ? 404 : badRequest.has(error.code) ? 400 : forbidden.has(error.code) ? 403 : 409;
    return Response.json({ error: error.code, message: error.message }, { status });
  }
  if (isAcknowledgmentTriggerError(error)) {
    return Response.json({ error: "ACKNOWLEDGMENT_CONFLICT", message: "That change conflicts with a rule on acknowledgment records." }, { status: 409 });
  }
  // The logger keeps only an error's class and code (never a Prisma message, which would echo the query and its values).
  logError("Acknowledgment request failed", error);
  return Response.json({ error: "ACKNOWLEDGMENT_REQUEST_FAILED", message: "The acknowledgment request could not be completed." }, { status: 500 });
}
