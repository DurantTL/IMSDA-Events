import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { countPublicMetric } from "@/modules/public-metrics/record";
import { issueLinkedAttendeeSession } from "@/modules/account-merge/unified-sign-in";
import {
  ATTENDEE_SESSION_COOKIE_NAME,
  ATTENDEE_SESSION_LIFETIME_SECONDS,
} from "@/modules/attendee-accounts/session-store";
import { withRequestContext } from "@/lib/request-context";
import { logError } from "@/lib/logger";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { passkeyApiError } from "@/modules/access/passkey-api";
import { STAFF_PASSKEY_SIGN_IN_COOKIE } from "@/modules/access/passkey-sign-in";
import { finishPasskeySignIn, PasskeyError } from "@/modules/access/passkeys";
import { passkeyVerificationSchema } from "@/modules/passkeys/schemas";
import { DEFAULT_POST_LOGIN_DESTINATION } from "@/modules/access/login-routing";
import { resolvePostLoginDestination } from "@/modules/access/post-login-destination";
import { SESSION_COOKIE_NAME, SESSION_LIFETIME_SECONDS } from "@/modules/access/session-store";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkStaffPasskeySignInRateLimit } from "@/modules/rate-limit/service";

const bodySchema = passkeyVerificationSchema.extend({
  // Where a deep link bounced from before landing on /login (#108 queue 1).
  // Validated against `lib/return-to.ts` before it can steer navigation, the
  // same as the password route.
  next: z.string().max(2048).optional().catch(undefined),
});

/**
 * The session cookie is already set when this runs, so a routing failure
 * must not turn a successful sign-in into an error. Falls back to the
 * pre-#108 default instead — the same fallback and the same routing
 * function the password route (`/api/auth/login`) uses (#429).
 */
async function postLoginDestinationOrDefault(
  user: Parameters<typeof resolvePostLoginDestination>[0],
  returnTo: string | undefined,
): Promise<string> {
  try {
    return await resolvePostLoginDestination(user, { returnTo });
  } catch (error) {
    logError("Passkey sign-in destination could not be resolved; using the default", error);
    return DEFAULT_POST_LOGIN_DESTINATION;
  }
}

/**
 * Signs in with a passkey (#429). A UV (user-verified) passkey is
 * phishing-resistant multi-factor on its own, so this completes sign-in
 * directly — no separate MFA challenge follows.
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const rateLimit = await checkStaffPasskeySignInRateLimit(request, "verify");
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json({ error: "RATE_LIMITED", message: "Too many sign-in attempts. Try again later." }, { status: 429 }), rateLimit);
    }
    const cookieStore = await cookies();
    const challengeId = cookieStore.get(STAFF_PASSKEY_SIGN_IN_COOKIE)?.value ?? null;
    // The prompt is single-use whatever happens next.
    cookieStore.delete({ name: STAFF_PASSKEY_SIGN_IN_COOKIE, path: "/api/auth/passkeys/sign-in" });
    const { response, next } = bodySchema.parse(await request.json());
    const result = await finishPasskeySignIn(
      challengeId,
      request.headers.get("origin"),
      response as unknown as AuthenticationResponseJSON,
      request.headers.get("user-agent"),
    ).catch((error: unknown) => {
      // Only a real verification failure counts: not a bad body, a store error, or anything after the session starts.
      if (error instanceof PasskeyError) countPublicMetric(request, "LOGIN_FAILURE", "staff-passkey");
      throw error;
    });
    cookieStore.set(SESSION_COOKIE_NAME, result.session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: result.session.expiresAt,
      maxAge: SESSION_LIFETIME_SECONDS,
      priority: "high",
    });
    countPublicMetric(request, "LOGIN_SUCCESS", "staff-passkey");
    // One account per person (#554): with the one-sign-in switch on, a staff person who just
    // passed the staff second factor also gets their linked attendee session, marked as having
    // passed the second step. Does nothing (null) with the switch off or with no usable link.
    const attendeeSession = await issueLinkedAttendeeSession(result.userId, request.headers.get("user-agent"), { secondFactorVerified: true });
    if (attendeeSession) {
      cookieStore.set(ATTENDEE_SESSION_COOKIE_NAME, attendeeSession.session.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        expires: attendeeSession.session.expiresAt,
        maxAge: ATTENDEE_SESSION_LIFETIME_SECONDS,
        priority: "high",
      });
    }
    const redirectTo = await postLoginDestinationOrDefault(
      { id: result.userId, globalRole: result.globalRole },
      next,
    );
    return applyRateLimitHeaders(Response.json({ ok: true, redirectTo }), rateLimit);
  } catch (error) {
    return passkeyApiError(error, "Signing in with a passkey");
  }
}

export const POST = withRequestContext(postHandler);
