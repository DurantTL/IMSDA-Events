/**
 * The server-only Cloudflare Turnstile Siteverify boundary (#1399). It posts one form-encoded request and returns a
 * typed result. Any network error, timeout, non-2xx answer or malformed body is a failure result: the caller fails
 * closed. Neither the secret nor the token is ever logged or returned.
 */

export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_SITEVERIFY_TIMEOUT_MS = 5000;

export type SiteverifyInput = {
  secret: string;
  token: string;
  remoteIp?: string | null;
};

export type SiteverifyResult =
  | { ok: true; action: string | null; hostname: string | null }
  | { ok: false; reason: "rejected" | "unreachable" | "malformed"; errorCodes: string[] };

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export async function verifyTurnstileToken(
  input: SiteverifyInput,
  fetchImpl: FetchLike = fetch,
  timeoutMs: number = TURNSTILE_SITEVERIFY_TIMEOUT_MS,
): Promise<SiteverifyResult> {
  const body = new URLSearchParams({ secret: input.secret, response: input.token });
  if (input.remoteIp) body.set("remoteip", input.remoteIp);

  let response: Response;
  try {
    response = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "unreachable", errorCodes: [] };
  }
  if (!response.ok) return { ok: false, reason: "unreachable", errorCodes: [] };

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { ok: false, reason: "malformed", errorCodes: [] };
  }
  if (!parsed || typeof parsed !== "object" || typeof (parsed as { success?: unknown }).success !== "boolean") {
    return { ok: false, reason: "malformed", errorCodes: [] };
  }

  const data = parsed as { success: boolean; action?: unknown; hostname?: unknown; "error-codes"?: unknown };
  if (data.success !== true) {
    const codes = Array.isArray(data["error-codes"])
      ? data["error-codes"].filter((code): code is string => typeof code === "string").slice(0, 10)
      : [];
    return { ok: false, reason: "rejected", errorCodes: codes };
  }
  return {
    ok: true,
    action: typeof data.action === "string" ? data.action : null,
    hostname: typeof data.hostname === "string" ? data.hostname : null,
  };
}
