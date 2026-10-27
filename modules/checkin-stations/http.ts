import "server-only";

import { z } from "zod";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { PaymentOperationError } from "@/modules/payments/repository";
import {
  CHECK_IN_STATION_COOKIE_NAME,
  STATION_INACTIVE_MESSAGE,
} from "@/modules/checkin-stations/domain";
import { resolveStation, type ResolvedStation } from "@/modules/checkin-stations/repository";
import { StationServiceError } from "@/modules/checkin-stations/service";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import type { RateLimitOutcome } from "@/modules/rate-limit/domain";

export const stationMaximumBodyBytes = 8 * 1_024;

export const stationPrivateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

export function stationJson(body: unknown, init?: ResponseInit) {
  return Response.json(body, { ...init, headers: { ...stationPrivateHeaders, ...init?.headers } });
}

export function applyStationPrivateHeaders(response: Response) {
  Object.entries(stationPrivateHeaders).forEach(([name, value]) => response.headers.set(name, value));
  return response;
}

class BodyTooLargeError extends Error {}

export async function readStationBody(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > stationMaximumBodyBytes) throw new BodyTooLargeError();
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > stationMaximumBodyBytes) throw new BodyTooLargeError();
  return JSON.parse(raw) as unknown;
}

const paymentMessages: Record<string, string> = {
  PAYMENT_EXCEEDS_BALANCE: "That is more than the balance due. Enter the amount actually received, up to the balance.",
  REGISTRATION_NOT_PAYABLE: "Payments can only be recorded for submitted or confirmed registrations. Send this person to the check-in desk.",
  REGISTRATION_NOT_FOUND: "We could not find that registration for this event.",
  PAYMENT_CONFLICT: "Another payment changed this registration at the same moment. Look the code up again and check the balance.",
};

export function stationApiError(error: unknown) {
  if (error instanceof StationServiceError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "PASS_EXPIRED" ? 410 : 409;
    return stationJson({ error: error.code, message: error.message }, { status });
  }
  if (error instanceof PaymentOperationError) {
    const status = error.code === "REGISTRATION_NOT_FOUND" ? 404 : 409;
    return stationJson(
      { error: error.code, message: paymentMessages[error.code] ?? error.message },
      { status },
    );
  }
  if (error instanceof BodyTooLargeError) {
    return stationJson({ error: "REQUEST_TOO_LARGE", message: "That request is too large." }, { status: 413 });
  }
  if (error instanceof z.ZodError) {
    return stationJson({
      error: "INVALID_REQUEST",
      message: error.issues[0]?.message ?? "Check the details and try again.",
    }, { status: 400 });
  }
  if (error instanceof SyntaxError) {
    return stationJson({ error: "INVALID_JSON", message: "That request was not understood." }, { status: 400 });
  }
  logError("Check-in station request failed", error);
  return stationJson(
    { error: "STATION_REQUEST_FAILED", message: "Something went wrong. Try again, or send this person to the check-in desk." },
    { status: 500 },
  );
}

export function stationInactiveResponse() {
  const response = stationJson({ error: "STATION_INACTIVE", message: STATION_INACTIVE_MESSAGE }, { status: 401 });
  // The device's cookie is no use any more; drop it so the page shows the plain message next time.
  response.headers.append(
    "Set-Cookie",
    `${CHECK_IN_STATION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`,
  );
  return response;
}

type StationPostOptions<T> = {
  /** Omit for a body-less action (stop). */
  schema?: z.ZodType<T>;
  capability?: "payments";
  rateLimit?: (station: ResolvedStation) => Promise<RateLimitOutcome>;
};

/**
 * One shape for every station POST: same-origin only, private headers, a bounded JSON body, the station resolved
 * from its own cookie on every call (no staff session is ever consulted), then the handler. Everything the handler
 * touches is scoped to `station.station.eventId`.
 */
export function stationPostHandler<T = undefined>(
  options: StationPostOptions<T>,
  run: (context: { station: ResolvedStation; input: T; request: Request }) => Promise<Response | unknown>,
) {
  return withRequestContext(async (request: Request) => {
    const originError = rejectCrossOriginRequest(request);
    if (originError) return applyStationPrivateHeaders(originError);
    try {
      const station = await resolveStation();
      if (!station) return stationInactiveResponse();
      if (options.capability === "payments" && !station.capabilities.canRecordPayments) {
        return stationJson({
          error: "PERMISSION_DENIED",
          message: "This station cannot record payments. Send the payment to the check-in desk or to finance.",
        }, { status: 403 });
      }
      let rateOutcome: RateLimitOutcome | null = null;
      if (options.rateLimit) {
        rateOutcome = await options.rateLimit(station);
        if (!rateOutcome.allowed) {
          return applyRateLimitHeaders(stationJson({
            error: "RATE_LIMITED",
            message: "Too many lookups. Wait a moment and try again.",
          }, { status: 429 }), rateOutcome);
        }
      }
      const input = (options.schema ? options.schema.parse(await readStationBody(request)) : undefined) as T;
      const result = await run({ station, input, request });
      const response = result instanceof Response ? result : stationJson(result);
      return rateOutcome ? applyRateLimitHeaders(response, rateOutcome) : response;
    } catch (error) {
      return stationApiError(error);
    }
  });
}
