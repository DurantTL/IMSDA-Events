import { logError } from "@/lib/logger";
import { verifyTurnstileToken, type SiteverifyResult } from "@/integrations/turnstile/siteverify";
import { trustedClientIpAddress } from "@/modules/rate-limit/domain";

/**
 * Cloudflare Turnstile on public forms and sign-in (#1399). One helper, `requireTurnstile`, is called by every form's
 * POST handler after its honeypot and rate limit and before any write or email.
 *
 * Modes (env only):
 * - Both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY set: enforce. A missing token, a failed check, the wrong action,
 *   a hostname that is not allowed, a timeout or any Siteverify error rejects the request (fail closed).
 * - Either unset: skip. In production that fails open on purpose, so a missing key never locks anyone out of sign-in
 *   or registration; the System report shows a "Security check not configured" warning.
 */

/** The header every form sends its Turnstile token in. */
export const TURNSTILE_TOKEN_HEADER = "x-turnstile-token";

export const TURNSTILE_ACTIONS = {
  staffSignIn: "staff-sign-in",
  attendeeSignIn: "attendee-sign-in",
  attendeeSignUp: "attendee-sign-up",
  forgotPassword: "forgot-password",
  registration: "registration",
  groupRegistration: "group-registration",
  clubApplication: "club-application",
  registrationRecovery: "registration-recovery",
  informationForm: "information-form",
} as const;

export type TurnstileAction = (typeof TURNSTILE_ACTIONS)[keyof typeof TURNSTILE_ACTIONS];

export const SECURITY_CHECK_FAILED_MESSAGE =
  "The security check didn't go through. Press Try again in the box. If it keeps failing, turn off a VPN or ad blocker, or contact the conference office.";
export const SECURITY_CHECK_MISSING_MESSAGE =
  "Finish the security check above, then submit again. Your answers are still here.";

export type TurnstileConfiguration =
  | { mode: "enforce"; siteKey: string; secretKey: string; allowedHostnames: string[] }
  | { mode: "skip"; missing: ("TURNSTILE_SITE_KEY" | "TURNSTILE_SECRET_KEY")[]; production: boolean };

type Source = Record<string, string | undefined>;

function hostOf(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    return new URL(value.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function getTurnstileConfiguration(source: Source = process.env): TurnstileConfiguration {
  const siteKey = source.TURNSTILE_SITE_KEY?.trim() ?? "";
  const secretKey = source.TURNSTILE_SECRET_KEY?.trim() ?? "";
  if (siteKey && secretKey) {
    const configured = (source.TURNSTILE_ALLOWED_HOSTNAMES ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    const allowedHostnames = configured.length > 0
      ? configured
      : [hostOf(source.APP_BASE_URL) ?? "localhost"];
    return { mode: "enforce", siteKey, secretKey, allowedHostnames };
  }
  const missing: ("TURNSTILE_SITE_KEY" | "TURNSTILE_SECRET_KEY")[] = [];
  if (!siteKey) missing.push("TURNSTILE_SITE_KEY");
  if (!secretKey) missing.push("TURNSTILE_SECRET_KEY");
  return { mode: "skip", missing, production: source.NODE_ENV === "production" };
}

/** The site key a server page hands to the client component, or null when the check is off. Never the secret. */
export function turnstileSiteKeyForPage(source: Source = process.env): string | null {
  const configuration = getTurnstileConfiguration(source);
  return configuration.mode === "enforce" ? configuration.siteKey : null;
}

export type TurnstileVerdict =
  | { ok: true; skipped: boolean }
  | { ok: false; code: "security_check_missing" | "security_check_failed" };

type Verifier = typeof verifyTurnstileToken;

/** Pure-ish core: decides from a configuration, a token and Siteverify's answer. */
export async function checkTurnstile(
  input: { action: TurnstileAction; token: string | null | undefined; remoteIp?: string | null },
  options: { configuration?: TurnstileConfiguration; verify?: Verifier } = {},
): Promise<TurnstileVerdict> {
  const configuration = options.configuration ?? getTurnstileConfiguration();
  if (configuration.mode === "skip") return { ok: true, skipped: true };

  const token = input.token?.trim();
  if (!token || token.length > 2048) return { ok: false, code: "security_check_missing" };

  let result: SiteverifyResult;
  try {
    result = await (options.verify ?? verifyTurnstileToken)({
      secret: configuration.secretKey,
      token,
      remoteIp: input.remoteIp,
    });
  } catch {
    return { ok: false, code: "security_check_failed" };
  }
  if (!result.ok) return { ok: false, code: "security_check_failed" };
  if (result.action !== input.action) return { ok: false, code: "security_check_failed" };
  if (!result.hostname || !configuration.allowedHostnames.includes(result.hostname.toLowerCase())) {
    return { ok: false, code: "security_check_failed" };
  }
  return { ok: true, skipped: false };
}

/**
 * Call in a POST handler after the honeypot and rate limit and before any write or side effect. Returns null to
 * continue, or the JSON response to return. The token comes from the `x-turnstile-token` header.
 */
export async function requireTurnstile(
  request: Request,
  { action, token }: { action: TurnstileAction; token?: string | null },
): Promise<Response | null> {
  let verdict: TurnstileVerdict;
  try {
    verdict = await checkTurnstile({
      action,
      token: token ?? request.headers.get(TURNSTILE_TOKEN_HEADER),
      remoteIp: trustedClientIpAddress(request),
    });
  } catch (error) {
    logError("Turnstile check could not run", error);
    verdict = { ok: false, code: "security_check_failed" };
  }
  if (verdict.ok) return null;
  return Response.json(
    {
      error: verdict.code,
      code: verdict.code,
      message: verdict.code === "security_check_missing" ? SECURITY_CHECK_MISSING_MESSAGE : SECURITY_CHECK_FAILED_MESSAGE,
    },
    { status: verdict.code === "security_check_missing" ? 400 : 403 },
  );
}
