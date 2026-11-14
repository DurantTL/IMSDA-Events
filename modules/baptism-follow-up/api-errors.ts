import "server-only";

import { z } from "zod";
import { logError } from "@/lib/logger";
import { AccessDeniedError } from "@/modules/access/authorization";
import { BaptismFollowUpError } from "@/modules/baptism-follow-up/settings";
import { ScopedToggleError } from "@/modules/event-modules/scoped-toggle";

const noStore = { "Cache-Control": "private, no-store" };
export const jsonNoStore = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

/** One answer for every Baptism follow-up route, staff and coordinator: a refusal says only that, and a failure never shows what went wrong inside. */
export function baptismApiError(error: unknown, failed: { log: string; message: string }) {
  if (error instanceof z.ZodError) return jsonNoStore({ error: "INVALID_REQUEST", message: "Review what you entered." }, 400);
  if (error instanceof SyntaxError) return jsonNoStore({ error: "INVALID_JSON", message: "The request is not valid JSON." }, 400);
  if (error instanceof AccessDeniedError) return jsonNoStore({ error: error.code, message: error.message }, error.status);
  if (error instanceof ScopedToggleError) return jsonNoStore({ error: error.code, message: error.message }, 404);
  if (error instanceof BaptismFollowUpError) {
    const status = error.code === "EVENT_NOT_FOUND" || error.code === "FOLLOW_UP_NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 422;
    return jsonNoStore({ error: error.code, message: error.message }, status);
  }
  logError(failed.log, error);
  return jsonNoStore({ error: "BAPTISM_FOLLOW_UP_FAILED", message: failed.message }, 500);
}
