import { z } from "zod";
import { logError } from "@/lib/logger";
import { AccessDeniedError } from "@/modules/access/authorization";
import { CamporeeScoringError } from "@/modules/camporee-scoring/service";

const noStore = { "Cache-Control": "private, no-store" };

/** One error shape for the two Camporee scoring routes (staff and Area Coordinator). */
export function camporeeApiError(error: unknown, action: string) {
  if (error instanceof z.ZodError) {
    return Response.json({ error: "INVALID_REQUEST", message: error.issues[0]?.message ?? "Review what you entered.", issues: error.issues }, { status: 400, headers: noStore });
  }
  if (error instanceof SyntaxError) return Response.json({ error: "INVALID_JSON", message: "The request is not valid JSON." }, { status: 400, headers: noStore });
  if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: noStore });
  if (error instanceof CamporeeScoringError) {
    if (error.code === "NOT_PERMITTED") return Response.json({ error: error.code, message: error.message }, { status: 403, headers: noStore });
    const status = error.code === "INVALID" ? 422 : 404;
    return Response.json({ error: error.code, message: error.message, ...(error.field ? { field: error.field } : {}) }, { status, headers: noStore });
  }
  logError(`${action} failed`, error);
  return Response.json({ error: "CAMPOREE_SCORING_FAILED", message: `${action} could not be completed.` }, { status: 500, headers: noStore });
}
