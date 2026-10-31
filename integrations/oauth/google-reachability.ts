import "server-only";

import { isGoogleSignInConfigured } from "@/integrations/oauth/google";
import { REACHABILITY_TIMEOUT_MS, type ReachabilityResult } from "@/modules/operations/reachability";

/** Google's public sign-in keys (the same address real sign-in reads). */
const GOOGLE_KEYS_URL = "https://www.googleapis.com/oauth2/v3/certs";

/**
 * A READ-ONLY test that Google's public sign-in keys can be fetched (#1380): one GET. It is a separate request from
 * real sign-in and never touches its key cache; the response body is read only to count keys and is not kept. The
 * result is one of four fixed words. Not set up (no Google sign-in client) means no request is made.
 */
export async function checkGoogleKeysReachable(
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<ReachabilityResult> {
  if (!isGoogleSignInConfigured()) return { outcome: "not-configured" };
  const started = Date.now();
  const done = (outcome: "reachable" | "refused" | "unavailable"): ReachabilityResult => ({ outcome, ms: Date.now() - started });
  try {
    const response = await (options.fetcher ?? fetch)(GOOGLE_KEYS_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? REACHABILITY_TIMEOUT_MS),
    });
    if (!response.ok) return done(response.status === 401 || response.status === 403 ? "refused" : "unavailable");
    const body = (await response.json()) as { keys?: unknown };
    return done(Array.isArray(body.keys) && body.keys.length > 0 ? "reachable" : "unavailable");
  } catch {
    return done("unavailable");
  }
}
