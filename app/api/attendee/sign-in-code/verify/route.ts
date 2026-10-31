import { z } from "zod";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { normalizeSubmittedCode, ONE_TIME_CODE_DIGITS } from "@/modules/attendee-accounts/codes";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { verifyAttendeeSignInCode } from "@/modules/attendee-accounts/sign-in-code-service";
import { accountNeedsSignInStep } from "@/modules/attendee-accounts/sign-in-gate";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkAttendeeSignInCodeVerifyRateLimit } from "@/modules/rate-limit/service";

const bodySchema = z.strictObject({ code: z.string().max(32) });

/**
 * Enters the emailed sign-in code (#1410). The rate limit is charged before anything is read or checked. The
 * answer never says which part was wrong beyond "didn't work" versus "expired": no code or hash is ever returned.
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { account, via, sessionId } = await getCurrentAttendee();
    if (!account || via !== "attendee" || !sessionId) {
      return Response.json(
        { error: "SIGN_IN_REQUIRED", message: "Sign in to enter a sign-in code." },
        { status: 401 },
      );
    }
    const rateLimit = await checkAttendeeSignInCodeVerifyRateLimit(request, account.id);
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json({
        error: "RATE_LIMITED",
        message: "Too many attempts. Wait a few minutes and try again.",
      }, { status: 429 }), rateLimit);
    }
    const { code } = bodySchema.parse(await request.json());
    if (!new RegExp(`^\\d{${ONE_TIME_CODE_DIGITS}}$`).test(normalizeSubmittedCode(code))) {
      return applyRateLimitHeaders(Response.json({
        error: "INVALID_CODE",
        message: `Enter the ${ONE_TIME_CODE_DIGITS}-digit code from the email.`,
      }, { status: 400 }), rateLimit);
    }
    if ((await accountNeedsSignInStep(account.id, sessionId)) !== "EMAIL_CODE") {
      return applyRateLimitHeaders(Response.json({ ok: true }), rateLimit);
    }
    const outcome = await verifyAttendeeSignInCode({ accountId: account.id, sessionId, code });
    if (outcome.ok) return applyRateLimitHeaders(Response.json({ ok: true }), rateLimit);
    if (outcome.reason === "NO_LIVE_CODE") {
      return applyRateLimitHeaders(Response.json({
        error: "CODE_EXPIRED",
        message: "That code has expired or was already used. Send a new code.",
      }, { status: 400 }), rateLimit);
    }
    return applyRateLimitHeaders(Response.json({
      error: "INVALID_CODE",
      message: "That code didn't work. Check the latest email, or send a new code.",
    }, { status: 400 }), rateLimit);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "INVALID_REQUEST", message: "That request could not be completed." }, { status: 400 });
    }
    logError("Checking the sign-in code failed", error);
    return Response.json(
      { error: "SIGN_IN_CODE_FAILED", message: "Sign-in codes are temporarily unavailable." },
      { status: 500 },
    );
  }
}

export const POST = withRequestContext(postHandler);
