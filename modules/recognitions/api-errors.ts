import "server-only";

import { z } from "zod";
import { logError } from "@/lib/logger";
import { AccessDeniedError } from "@/modules/access/authorization";
import { RecognitionError } from "@/modules/recognitions/repository";
import { TagConfigurationError } from "@/modules/tags/repository";

const noStore = { "Cache-Control": "private, no-store" };
export const jsonNoStore = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

/** One answer for every recognitions route: a refusal says only that, and a failure never shows what went wrong inside. */
export function recognitionApiError(error: unknown) {
  if (error instanceof z.ZodError) return jsonNoStore({ error: "INVALID_REQUEST", message: error.issues[0]?.message ?? "Review what you entered." }, 400);
  if (error instanceof SyntaxError) return jsonNoStore({ error: "INVALID_JSON", message: "The request is not valid JSON." }, 400);
  if (error instanceof AccessDeniedError) return jsonNoStore({ error: error.code, message: error.message }, error.status);
  if (error instanceof RecognitionError) {
    const status = error.code === "NOT_FOUND" ? 404 : 409;
    return jsonNoStore({ error: error.code, message: error.message }, status);
  }
  if (error instanceof TagConfigurationError) return jsonNoStore({ error: error.code, message: error.message }, error.code === "NOT_FOUND" ? 404 : 409);
  logError("Recognitions request failed", error);
  return jsonNoStore({ error: "RECOGNITIONS_REQUEST_FAILED", message: "The request could not be completed." }, 500);
}
