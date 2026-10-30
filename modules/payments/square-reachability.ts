import "server-only";

import { getSquareConfiguration } from "@/modules/payments/square-config";
import { REACHABILITY_TIMEOUT_MS, type ReachabilityResult } from "@/modules/operations/reachability";

/**
 * A READ-ONLY test that Square answers and accepts our access token (#1357): one GET of the locations list. It never
 * creates a payment, a link or anything else at Square. The result is one of four fixed words; no Square body, host,
 * token or URL is returned or logged. Lives in the payments module, beside the adapter, so Square calls stay together.
 */
export async function checkSquareReachable(
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<ReachabilityResult> {
  const configuration = getSquareConfiguration();
  if (!configuration.paymentConfigured) return { outcome: "not-configured" };
  const started = Date.now();
  const done = (outcome: "reachable" | "refused" | "unavailable"): ReachabilityResult => ({ outcome, ms: Date.now() - started });
  try {
    const response = await (options.fetcher ?? fetch)(`${configuration.apiUrl.replace(/\/$/, "")}/v2/locations`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${configuration.accessToken}`,
        "Square-Version": configuration.apiVersion,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? REACHABILITY_TIMEOUT_MS),
    });
    if (response.ok) return done("reachable");
    return done(response.status === 401 || response.status === 403 ? "refused" : "unavailable");
  } catch {
    return done("unavailable");
  }
}
