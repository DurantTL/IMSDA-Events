import { z } from "zod";
import { logError } from "@/lib/logger";
import { registrantActionSchema } from "@/modules/cancellation-requests/domain";
import {
  CancellationRequestError,
  getRegistrantRequestView,
  previewRegistrantRequest,
  submitCancellationRequest,
  withdrawCancellationRequest,
  type RegistrantActor,
  type RequestTarget,
} from "@/modules/cancellation-requests/repository";
import { AccessDeniedError } from "@/modules/access/authorization";

/**
 * The registrant's cancellation request endpoints (#170), shared by the private manage link and the signed-in portal.
 * The caller has already authorized the registration (a token, or an account that owns it) and passes the target; this
 * file never takes a registration or event id from the request body.
 */

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

export function privateJson(body: unknown, init?: ResponseInit) {
  return Response.json(body, { ...init, headers: { ...privateHeaders, ...init?.headers } });
}

export const maximumRequestBodyBytes = 8 * 1_024;

export function requestError(error: unknown, action: string) {
  if (error instanceof z.ZodError) {
    return privateJson({ error: "INVALID_REQUEST", message: error.issues[0]?.message ?? "Review the entries and try again.", issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })) }, { status: 400 });
  }
  if (error instanceof SyntaxError) {
    return privateJson({ error: "INVALID_JSON", message: "The request is not valid JSON." }, { status: 400 });
  }
  if (error instanceof AccessDeniedError) {
    return privateJson({ error: error.code, message: error.message }, { status: error.status });
  }
  if (error instanceof CancellationRequestError) {
    const status = error.code === "REQUEST_NOT_FOUND" ? 404
      : error.code === "NOT_AVAILABLE" ? 403
        : error.code === "CALCULATION_UNAVAILABLE" ? 422
          : 409;
    return privateJson({ error: error.code, message: error.message, ...(error.detail ?? {}) }, { status });
  }
  logError(`${action} failed`, error);
  return privateJson({ error: "CANCELLATION_REQUEST_FAILED", message: "The cancellation request could not be completed. Try again in a moment." }, { status: 500 });
}

export async function registrantView(target: RequestTarget) {
  return privateJson({ view: await getRegistrantRequestView(target) });
}

/** preview, submit or withdraw for one authorized registration. */
export async function registrantAction(target: RequestTarget, actor: RegistrantActor, rawBody: string) {
  if (new TextEncoder().encode(rawBody).byteLength > maximumRequestBodyBytes) {
    return privateJson({ error: "REQUEST_TOO_LARGE", message: "The request is too large." }, { status: 413 });
  }
  const input = registrantActionSchema.parse(JSON.parse(rawBody));
  if (input.action === "preview") {
    return privateJson({ proposal: await previewRegistrantRequest(target, input.selection) });
  }
  if (input.action === "submit") {
    const outcome = await submitCancellationRequest(target, actor, input);
    return privateJson({ ...outcome, view: await getRegistrantRequestView(target) }, { status: outcome.duplicate ? 200 : 201 });
  }
  const request = await withdrawCancellationRequest(target, input.requestId);
  return privateJson({ request, view: await getRegistrantRequestView(target) });
}
