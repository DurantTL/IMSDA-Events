import "server-only";

import { logError } from "@/lib/logger";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { checkSecurityCheckFallbackRateLimit } from "@/modules/rate-limit/service";
import {
  SECURITY_CHECK_CODE_HEADER,
  verifySecurityCheckCode,
} from "@/modules/security/security-check-code-store";
import {
  SECURITY_CHECK_CODE_FAILED_MESSAGE,
  type SecurityCheckFallback,
  type TurnstileAction,
} from "@/modules/security/turnstile";

/**
 * What happens when a request reaches `requireTurnstile` with NO token (#1480). Called only in enforce mode and only
 * when the route passed a fallback. A request that carries a token never gets here: an invalid token is rejected by
 * `requireTurnstile` itself, and any code sent beside it is ignored.
 *
 * Returns null when this fallback does not apply (the caller then answers `security_check_missing` as before), or
 * `{ response }` where a null response means "allowed, continue" and a Response is the rejection to send.
 */
export async function applySecurityCheckFallback(
  request: Request,
  action: TurnstileAction,
  fallback: SecurityCheckFallback,
): Promise<{ response: Response | null } | null> {
  if (fallback.kind === "email-code") {
    const code = request.headers.get(SECURITY_CHECK_CODE_HEADER)?.trim();
    if (!code) return null;
    const accepted = code.length <= 32
      && (await verifySecurityCheckCode({ action, email: fallback.email, code })).ok;
    if (accepted) return { response: null };
    // One answer for a wrong, expired, spent or never-issued code, so it cannot be used to probe for an account.
    return {
      response: Response.json(
        { error: "security_check_failed", code: "security_check_failed", message: SECURITY_CHECK_CODE_FAILED_MESSAGE },
        { status: 403 },
      ),
    };
  }

  // A public form: allowed without a token, but only through a far stricter limit than the form's own.
  const limit = await checkSecurityCheckFallbackRateLimit(request, fallback.email);
  if (!limit.allowed) {
    return {
      response: Response.json(
        {
          error: "RATE_LIMITED",
          message: "Too many tries without the security check. Try again in an hour, or contact the conference office.",
        },
        { status: 429 },
      ),
    };
  }
  // Flagged for staff awareness only: the action and the route, no name, address or answers. Never shown to the person.
  await writeAuditLog({
    action: "SECURITY_CHECK_FALLBACK_ACCEPTED",
    entityType: "SecurityCheck",
    entityId: action,
    summary: "A public form was accepted without a security check token because the check could not load.",
    metadata: { checkAction: action, route: new URL(request.url).pathname },
  }).catch((error) => logError("A security check fallback audit entry could not be written", error));
  return { response: null };
}
