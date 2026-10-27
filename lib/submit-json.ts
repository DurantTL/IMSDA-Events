/**
 * The one client helper for submitting JSON (#1263). It never leaves a spinner and never lets a
 * restart or deploy look like a lost form: a network error, a gateway page (502/503/504 or any 5xx
 * that is not JSON) or the app's own `UPDATING` answer becomes `unavailable: true` with one fixed,
 * friendly message. Callers keep their form values and offer "Try again".
 *
 * One quiet automatic retry runs after a short pause, but only when it cannot do harm:
 *  - the app answered `UPDATING`, which proves it never handled the request, or
 *  - the caller marked the request `idempotent` (the server dedupes on a key carried in the body),
 *    in which case a bare network error or a gateway page is retried too. A gateway page alone
 *    proves nothing: the app may have committed the work before the proxy gave up.
 * A timeout is never "unavailable" and never retried: the request may still be running. A 4xx or a
 * JSON answer the app produced (a real 500, a "busy" 503) is passed through untouched.
 */
export const submitJsonTimeoutMs = 60_000;
export const submitJsonRetryDelayMs = 4_000;
export const SITE_UPDATING_MESSAGE = "The site is updating. Your answers are still here — try again in a minute.";
export const SITE_UPDATING_CODE = "UPDATING";

export type SubmitJsonMethod = "POST" | "PUT" | "PATCH" | "DELETE";

export type SubmitJsonResult = {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
  /** True when the site could not be reached or was restarting; the form should keep its values and offer Try again. */
  unavailable?: boolean;
};

export type SubmitJsonOptions = {
  method?: SubmitJsonMethod;
  /** The body carries a key the server dedupes on, so repeating the request is safe even if it arrived. */
  idempotent?: boolean;
  timeoutMs?: number;
  /** Pause before the single automatic retry. Tests inject a short one. */
  retryDelayMs?: number;
  /** Starts every synthesized message (timeouts and generic failures). */
  fallbackMessage?: string;
  /** For tests and callers that inject their own fetch. */
  fetchImpl?: typeof fetch;
  /** Extra fetch settings, such as `credentials`. */
  init?: Omit<RequestInit, "method" | "body" | "signal">;
};

type Attempt =
  | { kind: "response"; status: number; ok: boolean; body: Record<string, unknown> | null }
  | { kind: "network" }
  | { kind: "timeout" };

function updatingResult(status: number): SubmitJsonResult {
  return { ok: false, status, unavailable: true, body: { code: SITE_UPDATING_CODE, message: SITE_UPDATING_MESSAGE } };
}

async function attempt(url: string, method: SubmitJsonMethod, payload: unknown, timeoutMs: number, init: SubmitJsonOptions["init"], fetchImpl: typeof fetch): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...init,
      method,
      // A FormData body (a file upload) sets its own multipart header.
      headers: { ...(payload instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(init?.headers as Record<string, string> | undefined) },
      ...(payload === undefined ? {} : { body: payload instanceof FormData ? payload : JSON.stringify(payload) }),
      signal: controller.signal,
    });
    // The body is read inside the timeout too: a response that starts and never ends is aborted.
    let body: unknown = null;
    try {
      body = await response.json();
    } catch (readError) {
      if (readError instanceof Error && readError.name === "AbortError") throw readError;
    }
    const isObject = Boolean(body) && typeof body === "object" && !Array.isArray(body);
    return { kind: "response", status: response.status, ok: response.ok, body: isObject ? (body as Record<string, unknown>) : null };
  } catch (error) {
    return error instanceof Error && error.name === "AbortError" ? { kind: "timeout" } : { kind: "network" };
  } finally {
    clearTimeout(timer);
  }
}

/** True when the app itself answered "updating": a restart in progress, nothing was handled. */
function isUpdatingBody(body: Record<string, unknown> | null) {
  return body?.code === SITE_UPDATING_CODE;
}

/**
 * Only the app's own UPDATING answer proves it never handled the request. A gateway page does not:
 * a 504 means the proxy gave up while the app may still commit, a 502 can follow a committed transaction.
 */
function provedUnhandled(result: Attempt) {
  return result.kind === "response" && isUpdatingBody(result.body);
}

function isUnavailable(result: Attempt) {
  if (result.kind === "network") return true;
  if (result.kind !== "response") return false;
  if (isUpdatingBody(result.body)) return true;
  // A page that is not JSON from a server error is a gateway or crash page, not an answer from the app.
  return result.status >= 500 && result.body === null;
}

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function submitJson(
  url: string,
  payload: unknown,
  options: SubmitJsonOptions & { wait?: (ms: number) => Promise<void> } = {},
): Promise<SubmitJsonResult> {
  const {
    method = "POST", idempotent = false, timeoutMs = submitJsonTimeoutMs, retryDelayMs = submitJsonRetryDelayMs,
    fallbackMessage = "", init, wait = defaultWait, fetchImpl = (...args) => fetch(...args),
  } = options;
  const prefix = fallbackMessage ? `${fallbackMessage} ` : "";

  let result = await attempt(url, method, payload, timeoutMs, init, fetchImpl);
  if (isUnavailable(result) && (provedUnhandled(result) || idempotent)) {
    await wait(retryDelayMs);
    result = await attempt(url, method, payload, timeoutMs, init, fetchImpl);
  }

  if (result.kind === "timeout") {
    return { ok: false, status: 0, body: { message: `${prefix}It is taking too long. Check whether it finished before trying again.` } };
  }
  if (isUnavailable(result)) return updatingResult(result.kind === "response" ? result.status : 0);
  if (result.kind !== "response") return updatingResult(0);
  if (result.body === null) {
    return { ok: false, status: result.status, body: { message: `${prefix}The server answered with an error (${result.status}). Try again in a moment.` } };
  }
  return { ok: result.ok, status: result.status, body: result.body };
}
