import "server-only";

import { getActiveEmailProviderName, getEmailAvailability } from "./provider";
import { getResendEmailConfiguration } from "./resend";
import { getSesEmailConfiguration, verifySesConnection } from "./ses";
import { REACHABILITY_TIMEOUT_MS, type ReachabilityOutcome, type ReachabilityResult } from "@/modules/operations/reachability";
import { EmailProviderConfigurationError } from "./types";

/**
 * A READ-ONLY test that the email provider answers and recognizes our credentials (#1357). It never sends a message,
 * creates a domain or writes anything at the provider: Resend gets one GET of the domain list, SES gets the SMTP
 * connect and login that `verifySesConnection` already does, with no message. The result is one of four fixed words;
 * no provider body, host, key or URL is ever returned or logged.
 */

/** How a Resend answer to the domain list reads. A send-only ("restricted") key is refused that list but is recognized. */
export async function resendOutcome(response: Response): Promise<ReachabilityOutcome> {
  if (response.ok) return "reachable";
  if (response.status === 401) {
    const body = await response.json().catch(() => null) as { name?: unknown } | null;
    return body?.name === "restricted_api_key" ? "reachable" : "refused";
  }
  if (response.status === 403) return "refused";
  return "unavailable";
}

export async function checkEmailReachable(
  options: { fetcher?: typeof fetch; timeoutMs?: number; verifySes?: typeof verifySesConnection } = {},
): Promise<ReachabilityResult> {
  if (!getEmailAvailability().deliveryConfigured) return { outcome: "not-configured" };
  const timeoutMs = options.timeoutMs ?? REACHABILITY_TIMEOUT_MS;
  const started = Date.now();
  const done = (outcome: ReachabilityOutcome): ReachabilityResult => ({ outcome, ms: Date.now() - started });
  try {
    if (getActiveEmailProviderName() === "SES") {
      const verify = options.verifySes ?? verifySesConnection;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      });
      try {
        await Promise.race([verify(getSesEmailConfiguration()), timeout]);
      } finally {
        clearTimeout(timer);
      }
      return done("reachable");
    }
    const { apiKey, apiUrl } = getResendEmailConfiguration();
    const response = await (options.fetcher ?? fetch)(`${apiUrl.replace(/\/$/, "")}/domains`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return done(await resendOutcome(response));
  } catch (error) {
    // Bad credentials are the provider saying no; anything else (timeout, network, TLS) is "could not tell".
    return done(error instanceof EmailProviderConfigurationError ? "refused" : "unavailable");
  }
}
