import { Prisma } from "@prisma/client";
import { z } from "zod";
import { AccessDeniedError } from "@/modules/access/authorization";
import { ApplicabilityAgeBandError } from "@/modules/consent/domain";
import { ConsentPolicyError } from "@/modules/consent/repository";

const notFoundCodes = new Set<ConsentPolicyError["code"]>([
  "POLICY_NOT_FOUND",
  "VERSION_NOT_FOUND",
  "APPLICABILITY_NOT_FOUND",
  "ATTENDEE_TYPE_NOT_FOUND",
]);

/** SQLSTATE the consent triggers raise (immutable rows, wrong-event references, bad current-version pointer). */
export const CONSENT_TRIGGER_SQLSTATE = "CP001";

function isConsentTriggerError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError) {
    return error.message.includes(CONSENT_TRIGGER_SQLSTATE) || (error as { meta?: { code?: string } }).meta?.code === CONSENT_TRIGGER_SQLSTATE;
  }
  return false;
}

export function consentPolicyApiError(error: unknown) {
  if (error instanceof z.ZodError) return Response.json({ error: "INVALID_CONSENT_POLICY", message: error.issues[0]?.message, issues: error.issues }, { status: 400 });
  if (error instanceof ApplicabilityAgeBandError) return Response.json({ error: "INVALID_CONSENT_POLICY", message: error.message }, { status: 400 });
  if (error instanceof SyntaxError) return Response.json({ error: "INVALID_CONSENT_POLICY", message: "The request body must be JSON." }, { status: 400 });
  if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
  if (error instanceof ConsentPolicyError && error.code === "EFFECTIVE_FROM_IN_PAST") return Response.json({ error: error.code, message: error.message }, { status: 400 });
  if (isConsentTriggerError(error)) return Response.json({ error: "CONSENT_POLICY_CONFLICT", message: "That change conflicts with a rule on published policies." }, { status: 409 });
  if (error instanceof ConsentPolicyError) return Response.json({ error: error.code, message: error.message }, { status: notFoundCodes.has(error.code) ? 404 : 409 });
  return Response.json({ error: "CONSENT_POLICY_REQUEST_FAILED", message: "The policy request could not be completed." }, { status: 500 });
}
