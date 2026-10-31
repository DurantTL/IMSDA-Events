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
  environment: string;
  warnings: string[];
  state: "ok" | "warning" | "invalid";
};

export function describeOwnConnection(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): OwnConnection {
  const environment = env.NODE_ENV === "production" ? "production" : env.NODE_ENV === "test" ? "test" : "development";
  let configuration;
  try {
    configuration = getRateLimitConfiguration(env);
  } catch (error) {
    if (!(error instanceof RateLimitConfigurationError)) throw error;
    return {
      resolvedIp: null,
      header: null,
      hops: null,
      environment,
      state: "invalid",
      warnings: [`The proxy settings are invalid, so the app cannot work out visitor addresses. ${error.message}`],
    };
  }

  const resolvedIp = trustedClientIpAddress(request, configuration);
  const warnings: string[] = [];
  if (resolvedIp && isCloudflareAddress(resolvedIp)) {
    warnings.push(
      "This address belongs to Cloudflare, so every visitor may share one rate limit. Set RATE_LIMIT_CLIENT_IP_HEADER=cf-connecting-ip with hops 1 (or x-forwarded-for with hops 2).",
    );
  }
  if (configuration.environment === "production" && configuration.trustedProxyHops === 0) {
    warnings.push("Proxy hops is 0 in production, so every visitor shares one rate limit.");
  }

  return {
    resolvedIp,
    header: configuration.clientIpHeader,
    hops: configuration.trustedProxyHops,
    environment: configuration.environment,
    warnings,
    state: warnings.length > 0 ? "warning" : "ok",
  };
}
