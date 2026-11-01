import { cookies } from "next/headers";
import { z } from "zod";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { verifyAttendeeEmailByAddress } from "@/modules/attendee-accounts/account-service";
import {
  ATTENDEE_SESSION_LIFETIME_SECONDS,
} from "@/modules/attendee-accounts/session-store";
import { applyRateLimitHeaders, mergeRateLimitOutcomes, type RateLimitOutcome } from "@/modules/rate-limit/domain";
import { checkAttendeeVerificationRateLimit, checkAttendeeVerifyByAddressRateLimit } from "@/modules/rate-limit/service";
import { attendeeSessionCookie } from "@/modules/security/session-cookies";

/**
 * Completes a verification an administrator asked for ("Send verification email"):
 * the address and the six-digit code from that email, with no pending cookie,
 * because the person never held the request handle. It accepts only an ACTIVE
 * account whose verification was cleared; every other case, a wrong code and an
 * unknown address included, gets the same answer.
 */
const schema = z.object({
  email: z.string().trim().email().max(254),
  code: z.string().transform((value) => value.replace(/\s+/g, "")).pipe(z.string().min(1).max(32)),
});

const REFUSAL = {
  error: "INVALID_CODE",
  message: "That address or code is not right, or the code has expired. Ask for a new one to try again.",
};

async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;

  let rateLimit: RateLimitOutcome | undefined;
  try {
    rateLimit = await checkAttendeeVerificationRateLimit(request);
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json({ error: "RATE_LIMITED", message: "Too many attempts. Try again later." }, { status: 429 }), rateLimit);
    }
    const input = schema.parse(await request.json());
    rateLimit = mergeRateLimitOutcomes(rateLimit, await checkAttendeeVerifyByAddressRateLimit(request, input.email));
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json({ error: "RATE_LIMITED", message: "Too many attempts. Try again later." }, { status: 429 }), rateLimit);
    }

    const verification = await verifyAttendeeEmailByAddress({
      email: input.email,
      code: input.code,
      userAgent: request.headers.get("user-agent"),
    });
    if (verification.outcome === "rejected") {
      return applyRateLimitHeaders(Response.json(REFUSAL, { status: 400 }), rateLimit);
    }
    attendeeSessionCookie.set((await cookies()), verification.session.token, { expires: verification.session.expiresAt, maxAge: ATTENDEE_SESSION_LIFETIME_SECONDS });
    return applyRateLimitHeaders(Response.json({ ok: true }), rateLimit);
  } catch (error) {
    // Malformed JSON is bad input like any other: the same refusal, not a server error.
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      const response = Response.json(REFUSAL, { status: 400 });
      return rateLimit ? applyRateLimitHeaders(response, rateLimit) : response;
    }
    logError("Verification by address failed", error);
    const response = Response.json({ error: "VERIFY_FAILED", message: "Verification is temporarily unavailable." }, { status: 500 });
    return rateLimit ? applyRateLimitHeaders(response, rateLimit) : response;
  }
}

export const POST = withRequestContext(postHandler);
