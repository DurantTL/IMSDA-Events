import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { logError } from "@/lib/logger";
import { countPublicMetric } from "@/modules/public-metrics/record";
import { PasskeyError as StaffPasskeyError } from "@/modules/access/passkeys";
import { PasskeyError as AttendeePasskeyError } from "@/modules/attendee-accounts/passkeys";
import { withRequestContext } from "@/lib/request-context";
import { DEFAULT_POST_LOGIN_DESTINATION } from "@/modules/access/login-routing";
import { passkeyApiError } from "@/modules/access/passkey-api";
import { resolvePostLoginDestination } from "@/modules/access/post-login-destination";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { SESSION_COOKIE_NAME, SESSION_LIFETIME_SECONDS } from "@/modules/access/session-store";
import { finishCombinedPasskeySignIn } from "@/modules/account-merge/combined-passkey-sign-in";
import { COMBINED_PASSKEY_SIGN_IN_COOKIE } from "@/modules/account-merge/combined-passkey-sign-in-cookie";
import { issueLinkedAttendeeSession } from "@/modules/account-merge/unified-sign-in";
import { attendeeReturnDestination } from "@/modules/attendee-accounts/return-destination";
import { ATTENDEE_SESSION_COOKIE_NAME, ATTENDEE_SESSION_LIFETIME_SECONDS } from "@/modules/attendee-accounts/session-store";
import { passkeyVerificationSchema } from "@/modules/passkeys/schemas";
import { applyRateLimitHeaders, mergeRateLimitOutcomes } from "@/modules/rate-limit/domain";
import { checkAttendeePasskeySignInRateLimit, checkStaffPasskeySignInRateLimit } from "@/modules/rate-limit/service";

const bodySchema = passkeyVerificationSchema.extend({
  // Where a deep link bounced from before landing on /sign-in. Validated against
  // `lib/return-to.ts` before it can steer navigation, as on the other sign-in routes.
  next: z.string().max(2048).optional().catch(undefined),
});

async function staffDestinationOrDefault(
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
 * Finishes the one-sign-in passkey prompt (#1085). A staff passkey gives exactly what the
 * staff passkey route gives (staff session plus the linked attendee session); an attendee
 * passkey gives the attendee session only, never a staff one. Both prompts are spent
 * whatever happens.
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const rateLimit = mergeRateLimitOutcomes(
      await checkStaffPasskeySignInRateLimit(request, "verify"),
      await checkAttendeePasskeySignInRateLimit(request, "verify"),
    );
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json({ error: "RATE_LIMITED", message: "Too many sign-in attempts. Try again later." }, { status: 429 }), rateLimit);
    }
    const cookieStore = await cookies();
    const handle = cookieStore.get(COMBINED_PASSKEY_SIGN_IN_COOKIE)?.value ?? null;
    // The prompt is single-use whatever happens next.
    cookieStore.delete({ name: COMBINED_PASSKEY_SIGN_IN_COOKIE, path: "/api/sign-in/passkey" });
    const { response, next } = bodySchema.parse(await request.json());
    const result = await finishCombinedPasskeySignIn(
      handle,
      request.headers.get("origin"),
      response as unknown as AuthenticationResponseJSON,
      request.headers.get("user-agent"),
    ).catch((error: unknown) => {
      // Only a real verification failure counts: not a bad body, a store error, or anything after the session starts.
      if (error instanceof StaffPasskeyError || error instanceof AttendeePasskeyError) countPublicMetric(request, "LOGIN_FAILURE", "unified-passkey");
      throw error;
    });

    if (result.kind === "attendee") {
      countPublicMetric(request, "LOGIN_SUCCESS", "unified-passkey");
      cookieStore.set(ATTENDEE_SESSION_COOKIE_NAME, result.session.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        expires: result.session.expiresAt,
        maxAge: ATTENDEE_SESSION_LIFETIME_SECONDS,
        priority: "high",
      });
      return applyRateLimitHeaders(Response.json({ ok: true, attendee: true, redirectTo: attendeeReturnDestination(next, "/account") }), rateLimit);
    }

    countPublicMetric(request, "LOGIN_SUCCESS", "unified-passkey");
    cookieStore.set(SESSION_COOKIE_NAME, result.session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: result.session.expiresAt,
      maxAge: SESSION_LIFETIME_SECONDS,
      priority: "high",
    });
    // A user-verified staff passkey also earns the linked attendee session, marked as having
    // passed the second step (one account per person, #554). Null with no usable link.
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
    const redirectTo = await staffDestinationOrDefault({ id: result.userId, globalRole: result.globalRole }, next);
    return applyRateLimitHeaders(Response.json({ ok: true, redirectTo }), rateLimit);
  } catch (error) {
    return passkeyApiError(error, "Signing in with a passkey");
  }
}

export const POST = withRequestContext(postHandler);
