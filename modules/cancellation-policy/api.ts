import { z } from "zod";
import { AccessDeniedError } from "@/modules/access/authorization";
import { CancellationPolicyError } from "@/modules/cancellation-policy/repository";
import { logError } from "@/lib/logger";

export function cancellationPolicyApiError(error: unknown, action: string) {
  if (error instanceof z.ZodError) {
    return Response.json(
      { error: "INVALID_CANCELLATION_POLICY_INPUT", message: error.issues[0]?.message ?? "Review the entries.", issues: error.issues },
      { status: 400 },
    );
  }
  if (error instanceof SyntaxError) {
    return Response.json({ error: "INVALID_JSON", message: "The request body must be JSON." }, { status: 400 });
  }
  if (error instanceof AccessDeniedError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status });
  }
  if (error instanceof CancellationPolicyError) {
    const status = error.code === "EVENT_NOT_FOUND" || error.code === "REGISTRATION_NOT_FOUND"
      ? 404
      : error.code === "EFFECTIVE_DATE_IN_PAST" || error.code === "EFFECTIVE_DATE_BEFORE_LATEST" ? 400 : 409;
    return Response.json({ error: error.code, message: error.message }, { status });
  }
  logError(`${action} failed`, error);
  return Response.json({ error: "CANCELLATION_POLICY_FAILED", message: "The cancellation policy request could not be completed." }, { status: 500 });
}
