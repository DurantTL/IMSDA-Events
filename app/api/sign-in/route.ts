import { cookies } from "next/headers";
import { z } from "zod";
import { logError } from "@/lib/logger";
import { countPublicMetric } from "@/modules/public-metrics/record";
import { withRequestContext } from "@/lib/request-context";
import { issueMfaChallenge } from "@/modules/access/mfa-service";
import { DEFAULT_POST_LOGIN_DESTINATION } from "@/modules/access/login-routing";
import { resolvePostLoginDestination } from "@/modules/access/post-login-destination";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { SESSION_COOKIE_NAME, SESSION_LIFETIME_SECONDS } from "@/modules/access/session-store";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import { unifiedPasswordSignIn } from "@/modules/account-merge/unified-sign-in";
import { attendeeReturnDestination, signInCodePathFor } from "@/modules/attendee-accounts/return-destination";
import { startSignInCodeIfRequired } from "@/modules/attendee-accounts/sign-in-code-issue";
import {
  ATTENDEE_SESSION_COOKIE_NAME,
  ATTENDEE_SESSION_LIFETIME_SECONDS,
} from "@/modules/attendee-accounts/session-store";
import {
  applyRateLimitHeaders,
  mergeRateLimitOutcomes,
  type RateLimitOutcome,
} from "@/modules/rate-limit/domain";
import {
  checkAttendeeSignInRateLimit,
  checkLoginAccountRateLimit,
  checkLoginClientRateLimit,
} from "@/modules/rate-limit/service";

/**
 * The single sign-in (#554, ADR 0013, slice (c)): one email, one password, one
 * submit, for staff and for registrants. Only available while the one-sign-in
 * switch is on; with it off this route does not exist as far as callers can tell.
 *
 * The answer never varies with what exists. An unknown address, a wrong
 * password, a locked credential and a disabled account all return the same
 * status and body. A staff second step is offered only AFTER the staff password
 * is right.
 */

const signInSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
  next: z.string().max(2048).optional().catch(undefined),
});

const REFUSAL_BODY = {
  error: "INVALID_CREDENTIALS",
  message: "The email or password is incorrect, or the account is temporarily unavailable.",
} as const;

const RATE_LIMITED_BODY = {
  error: "RATE_LIMITED",
  message: "Too many sign-in attempts. Try again later.",
} as const;

async function staffDestinationOrDefault(
  user: Parameters<typeof resolvePostLoginDestination>[0],
  returnTo: string | undefined,
): Promise<string> {
  try {
    return await resolvePostLoginDestination(user, { returnTo });
  } catch (error) {
    logError("Sign-in destination could not be resolved; using the default", error);
    return DEFAULT_POST_LOGIN_DESTINATION;
  }
}

async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;

  let rateLimit: RateLimitOutcome | undefined;
  try {
    if (!(await isUnifiedSignInEnabled())) {
      return Response.json({ error: "NOT_FOUND", message: "Not found." }, { status: 404 });
    }

    rateLimit = await checkLoginClientRateLimit(request);
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json(RATE_LIMITED_BODY, { status: 429 }), rateLimit);
    }

    const input = signInSchema.parse(await request.json());
    // Per address and per source, counted the same for known and unknown addresses.
    rateLimit = mergeRateLimitOutcomes(
      rateLimit,
      await checkLoginAccountRateLimit(request, input.email),
      await checkAttendeeSignInRateLimit(request, input.email),
    );
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json(RATE_LIMITED_BODY, { status: 429 }), rateLimit);
    }

    const userAgent = request.headers.get("user-agent");
    const outcome = await unifiedPasswordSignIn(input.email, input.password, userAgent);

    if (outcome.kind === "refused") {
      countPublicMetric(request, "LOGIN_FAILURE", "unified-password");
      return applyRateLimitHeaders(Response.json(REFUSAL_BODY, { status: 401 }), rateLimit);
    }

    if (outcome.kind === "passkey_required") {
      return applyRateLimitHeaders(Response.json({
        error: "PASSKEY_REQUIRED",
        message: "This account signs in with a passkey. Choose “Sign in with a passkey”, or ask a system administrator to reset your two-step sign-in.",
      }, { status: 403 }), rateLimit);
    }

    if (outcome.kind === "mfa") {
      const challenge = await issueMfaChallenge(outcome.userId, outcome.gate, { userAgent });
      return applyRateLimitHeaders(Response.json({
        ok: true,
        mfa: {
          required: true,
          gate: outcome.gate,
          challengeToken: challenge.challengeToken,
          expiresAt: challenge.expiresAt.toISOString(),
        },
      }), rateLimit);
    }

    const cookieStore = await cookies();
    if (outcome.staff) {
      cookieStore.set(SESSION_COOKIE_NAME, outcome.staff.session.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        expires: outcome.staff.session.expiresAt,
        maxAge: SESSION_LIFETIME_SECONDS,
        priority: "high",
      });
    }
    if (outcome.attendee) {
      cookieStore.set(ATTENDEE_SESSION_COOKIE_NAME, outcome.attendee.session.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        expires: outcome.attendee.session.expiresAt,
        maxAge: ATTENDEE_SESSION_LIFETIME_SECONDS,
        priority: "high",
      });
    }
    countPublicMetric(request, "LOGIN_SUCCESS", "unified-password");
    // An attendee-only session for a club role without two-step sign-in owes the emailed code (#1410). Staff
    // sessions already passed their own stronger second step, and their linked attendee session is marked verified.
    const signInCode = outcome.attendee && !outcome.staff
      ? await startSignInCodeIfRequired({
        request,
        accountId: outcome.attendee.accountId,
        sessionToken: outcome.attendee.session.token,
      })
      : null;
    const redirectTo = signInCode?.required
      ? signInCodePathFor(input.next)
      : outcome.staff
      ? await staffDestinationOrDefault({ id: outcome.staff.userId, globalRole: outcome.staff.globalRole }, input.next)
      : attendeeReturnDestination(input.next, "/account");
    return applyRateLimitHeaders(Response.json(signInCode?.required
      ? { ok: true, redirectTo, signInCode: { required: true, sent: signInCode.sent, developmentCode: signInCode.developmentCode } }
      : { ok: true, redirectTo }), rateLimit);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const response = Response.json({ error: "INVALID_LOGIN", message: "Enter a valid email address and password." }, { status: 400 });
      return rateLimit ? applyRateLimitHeaders(response, rateLimit) : response;
    }
    logError("Sign-in failed", error);
    const response = Response.json({ error: "LOGIN_FAILED", message: "Sign-in is temporarily unavailable." }, { status: 500 });
    return rateLimit ? applyRateLimitHeaders(response, rateLimit) : response;
  }
}

export const POST = withRequestContext(postHandler);
