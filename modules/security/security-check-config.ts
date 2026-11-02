import { getFormsHelpContact } from "@/modules/system-admin/platform-settings";
import type { FormsHelpContact } from "@/modules/system-admin/forms-help-contact";
import { getRequestNonce } from "@/modules/security/request-nonce";
import { turnstileSiteKeyForPage } from "@/modules/security/turnstile";

/**
 * What a server page hands to the client `SecurityCheck` component (#1399): the public site key read at request time
 * (never NEXT_PUBLIC_, because the build runs before the host's environment is known), the CSP nonce for
 * Cloudflare's script tag, and the office contact (the footer help contact setting, #1443) the component shows when a
 * privacy browser blocks the check (#1480). Null while Turnstile is off, which makes the component render nothing.
 */
export async function securityCheckConfigForPage(): Promise<{ siteKey: string; nonce?: string; contact: FormsHelpContact } | null> {
  const siteKey = turnstileSiteKeyForPage();
  if (!siteKey) return null;
  return { siteKey, nonce: await getRequestNonce(), contact: await getFormsHelpContact() };
}
