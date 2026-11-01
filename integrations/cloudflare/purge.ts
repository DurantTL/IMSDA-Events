import "server-only";

/**
 * The Cloudflare "Automatic Cache Purge" webhook (#1429), the host panel's private URL.
 *
 * `CLOUDFLARE_PURGE_WEBHOOK_URL` is a SECRET: anyone holding it can purge the site's cache. It is read here, on the
 * server, and never leaves this module. The only way out is a fixed outcome word. Nothing here logs, and no error
 * (whose message can contain the URL) is returned or rethrown: every failure is mapped to a word below.
 *
 * The body is fixed: `{"purge_everything": true}`. No caller supplies a URL, a body or a method.
 */

export const CLOUDFLARE_PURGE_ENV_NAME = "CLOUDFLARE_PURGE_WEBHOOK_URL";
export const CLOUDFLARE_PURGE_TIMEOUT_MS = 10_000;

export type CloudflarePurgeOutcome = "purged" | "not-configured" | "rejected" | "unreachable" | "timeout";

type Env = Record<string, string | undefined>;

/** The URL when it is set and is an https address; otherwise null (an unusable value reads as not set up). */
function resolveWebhookUrl(env: Env): string | null {
  const value = env[CLOUDFLARE_PURGE_ENV_NAME]?.trim();
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** True when a usable webhook is set. This boolean is the only thing about the setting that may reach the browser. */
export function isCloudflarePurgeConfigured(env: Env = process.env): boolean {
  return resolveWebhookUrl(env) !== null;
}

export type CloudflarePurgeOptions = {
  env?: Env;
  /** Tests inject a mock; production uses the global fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export async function purgeCloudflareCache(options: CloudflarePurgeOptions = {}): Promise<CloudflarePurgeOutcome> {
  const url = resolveWebhookUrl(options.env ?? process.env);
  if (!url) return "not-configured";
  const send = options.fetch ?? fetch;
  try {
    const response = await send(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purge_everything: true }),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? CLOUDFLARE_PURGE_TIMEOUT_MS),
    });
    // Nothing of the response is read or kept.
    await response.body?.cancel().catch(() => undefined);
    return response.status >= 200 && response.status < 300 ? "purged" : "rejected";
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return name === "TimeoutError" || name === "AbortError" ? "timeout" : "unreachable";
  }
}
