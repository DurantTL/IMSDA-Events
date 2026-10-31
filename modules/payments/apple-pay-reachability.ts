import "server-only";

import { SQUARE_APPLE_PAY_ASSOCIATION_URL } from "@/modules/payments/apple-pay-association";
import { getSquareConfiguration } from "@/modules/payments/square-config";
import { REACHABILITY_TIMEOUT_MS, type ReachabilityResult } from "@/modules/operations/reachability";

/**
 * A READ-ONLY test that Square's Apple Pay domain file can be fetched (#1380): one GET, body never read or kept. Not set
 * up means Square payments are not configured (Apple Pay is only offered through Square), so no request is made. The
 * result is one of four fixed words.
 */
export async function checkApplePayFileReachable(
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<ReachabilityResult> {
  if (!getSquareConfiguration().paymentConfigured) return { outcome: "not-configured" };
  const started = Date.now();
  const done = (outcome: "reachable" | "refused" | "unavailable"): ReachabilityResult => ({ outcome, ms: Date.now() - started });
  try {
    const response = await (options.fetcher ?? fetch)(SQUARE_APPLE_PAY_ASSOCIATION_URL, {
      method: "GET",
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
