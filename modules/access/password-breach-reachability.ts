import { getServerEnv } from "@/lib/env";
import { isBreachCheckEnabled } from "@/modules/access/password-breach";
import { REACHABILITY_TIMEOUT_MS, type ReachabilityResult } from "@/modules/operations/reachability";

/** A fixed, made-up five-character prefix. It is never derived from any password. */
export const BREACH_TEST_PREFIX = "A0B1C";

/**
 * A READ-ONLY test that the password breach service answers (#1380): one GET of a single fixed prefix, with the same
 * headers real checks use. No password or hash is involved and the response body is never read or kept. The result is
 * one of four fixed words. Not set up (the breach check is off) means no request is made.
 */
export async function checkBreachServiceReachable(
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<ReachabilityResult> {
  if (!isBreachCheckEnabled()) return { outcome: "not-configured" };
  const started = Date.now();
  const done = (outcome: "reachable" | "refused" | "unavailable"): ReachabilityResult => ({ outcome, ms: Date.now() - started });
  try {
    const endpoint = new URL(BREACH_TEST_PREFIX, getServerEnv().PASSWORD_BREACH_CHECK_URL);
    const response = await (options.fetcher ?? fetch)(endpoint, {
      method: "GET",
      headers: { "Add-Padding": "true", "User-Agent": "imsda-events-password-policy" },
      signal: AbortSignal.timeout(options.timeoutMs ?? REACHABILITY_TIMEOUT_MS),
    });
    // The body is never read; release it so the connection is freed straight away.
    await response.body?.cancel().catch(() => {});
    if (response.ok) return done("reachable");
    return done(response.status === 401 || response.status === 403 ? "refused" : "unavailable");
  } catch {
    return done("unavailable");
  }
}
