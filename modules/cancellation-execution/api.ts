import { z } from "zod";
import { logError } from "@/lib/logger";
import { AccessDeniedError } from "@/modules/access/authorization";
import { CancellationExecutionError } from "@/modules/cancellation-execution/repository";

/** Error responses for the staff "Carry out" route (#171). Private and uncached like the rest of the finance routes. */
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export function executionJson(body: unknown, init?: ResponseInit) {
  return Response.json(body, { ...init, headers: { ...privateHeaders, ...init?.headers } });
}

export function executionError(error: unknown) {
  if (error instanceof z.ZodError) {
    return executionJson({ error: "INVALID_REQUEST", message: error.issues[0]?.message ?? "Review the entries and try again." }, { status: 400 });
  }
  if (error instanceof SyntaxError) {
    return executionJson({ error: "INVALID_JSON", message: "The request is not valid JSON." }, { status: 400 });
  }
  if (error instanceof AccessDeniedError) {
    return executionJson({ error: error.code, message: error.message }, { status: error.status });
  }
  if (error instanceof CancellationExecutionError) {
    const status = error.code === "REQUEST_NOT_FOUND" ? 404
      : error.code === "SCOPE_NOT_SUPPORTED" || error.code === "METHOD_REQUIRED" || error.code === "SQUARE_NOT_CONFIGURED" ? 422
        : 409;
    return executionJson({ error: error.code, message: error.message, ...(error.detail ?? {}) }, { status });
  }
  logError("Carrying out a cancellation failed", error);
  return executionJson({ error: "CANCELLATION_EXECUTION_FAILED", message: "The cancellation could not be carried out. Nothing was repeated; check this page and try again." }, { status: 500 });
}
