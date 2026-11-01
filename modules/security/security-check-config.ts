import { getRequestNonce } from "@/modules/security/request-nonce";
import { turnstileSiteKeyForPage } from "@/modules/security/turnstile";

/**
 * What a server page hands to the client `SecurityCheck` component (#1399): the public site key read at request time
 * (never NEXT_PUBLIC_, because the build runs before the host's environment is known) and the CSP nonce for
 * Cloudflare's script tag. Null while Turnstile is off, which makes the component render nothing.
 */
export async function securityCheckConfigForPage(): Promise<{ siteKey: string; nonce?: string } | null> {
  const siteKey = turnstileSiteKeyForPage();
  if (!siteKey) return null;
  return { siteKey, nonce: await getRequestNonce() };
}
