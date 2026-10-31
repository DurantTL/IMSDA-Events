import {
  getRateLimitConfiguration,
  RateLimitConfigurationError,
  trustedClientIpAddress,
} from "@/modules/rate-limit/domain";
import { isCloudflareAddress } from "@/modules/rate-limit/cloudflare-ranges";

/**
 * "Your connection as the app sees it" (#1397). Describes the address the app resolved for ONE request, the current
 * system admin's own visit, so they can check the proxy settings. Pure: it reads nothing but the request and the
 * environment it is handed, and it logs and stores nothing. Deliberately not a report Signal: signals carry no address.
 */
export type OwnConnection = {
  /** The resolved address, or null when it could not be resolved. */
  resolvedIp: string | null;
  /** The configured header name, or null when the settings are invalid. */
  header: string | null;
  hops: number | null;
  warnings: string[];
  state: "ok" | "warning" | "invalid";
};

export function describeOwnConnection(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): OwnConnection {
  let configuration;
  try {
    configuration = getRateLimitConfiguration(env);
  } catch (error) {
    if (!(error instanceof RateLimitConfigurationError)) throw error;
    // Show the raw header name and hop count when they can be read, so a bad secret does not hide good proxy settings.
    // Only those two values are read from the environment; the secret is never touched and the message never contains it.
    const rawHeader = env.RATE_LIMIT_CLIENT_IP_HEADER?.trim().toLowerCase() || "x-forwarded-for";
    const rawHops = env.RATE_LIMIT_TRUSTED_PROXY_HOPS?.trim() || "0";
    return {
      resolvedIp: null,
      header: rawHeader,
      hops: /^\d+$/.test(rawHops) ? Number(rawHops) : null,
      state: "invalid",
      warnings: [`The rate-limit settings are invalid, so the app cannot work out visitor addresses. ${error.message}`],
    };
  }

  const resolvedIp = trustedClientIpAddress(request, configuration);
  const warnings: string[] = [];
  if (resolvedIp && isCloudflareAddress(resolvedIp)) {
    warnings.push(
      configuration.clientIpHeader === "cf-connecting-ip"
        ? "This address belongs to Cloudflare, so every visitor may share one rate limit. Check that the proxy in front of the app (Nginx) passes the CF-Connecting-IP header through, and that the app accepts traffic only from Cloudflare."
        : "This address belongs to Cloudflare, so every visitor may share one rate limit. Set RATE_LIMIT_CLIENT_IP_HEADER=cf-connecting-ip with hops 1 (or x-forwarded-for with hops 2).",
    );
  }
  if (configuration.environment === "production" && configuration.trustedProxyHops === 0) {
    warnings.push("Proxy hops is 0 in production, so every visitor shares one rate limit.");
  }

  if (configuration.environment === "production" && configuration.trustedProxyHops > 0 && !resolvedIp) {
    warnings.push(
      "The app could not work out your address, so every visitor shares one rate limit. The configured header may be missing from the request, or the proxy may be replacing X-Forwarded-For instead of adding to it.",
    );
  }

  return {
    resolvedIp,
    header: configuration.clientIpHeader,
    hops: configuration.trustedProxyHops,
    warnings,
    state: warnings.length > 0 ? "warning" : "ok",
  };
}
