import { z } from "zod";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { normalizeSubmittedCode, ONE_TIME_CODE_DIGITS } from "@/modules/attendee-accounts/codes";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { accountHasSecondStepAccess } from "@/modules/attendee-accounts/sign-in-gate";
import { completeAttendeeTwoStepRecovery } from "@/modules/attendee-accounts/two-step-recovery";
import { notifyTwoStepRecovered } from "@/modules/attendee-accounts/two-step-recovery-issue";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkAttendeeTwoStepRecoveryVerifyRateLimit } from "@/modules/rate-limit/service";

const bodySchema = z.strictObject({ code: z.string().max(32) });

/**
 * Enters the emailed recovery code (#221). The rate limit is charged before anything is read or checked. The
 * answer never says more than "didn't work" versus "expired": no code or hash is ever returned. On success it
 * says where to go next: club roles set up a new method first, everyone else lands on their profile.
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { account, via, sessionId } = await getCurrentAttendee();
    if (!account || via !== "attendee" || !sessionId) {
      return Response.json(
        { error: "SIGN_IN_REQUIRED", message: "Sign in to recover two-step sign-in." },
        { status: 401 },
      );
    }
    const rateLimit = await checkAttendeeTwoStepRecoveryVerifyRateLimit(request, account.id);
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
    const now = new Date();
    const outcome = await completeAttendeeTwoStepRecovery({ accountId: account.id, sessionId, code, now });
    if (outcome.ok) {
      await notifyTwoStepRecovered(account.id, now);
      return applyRateLimitHeaders(Response.json({
        ok: true,
        setupRequired: await accountHasSecondStepAccess(account.id, now),
      }), rateLimit);
    }
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
    logError("Checking the two-step recovery code failed", error);
    return Response.json(
      { error: "TWO_STEP_RECOVERY_FAILED", message: "Recovering two-step sign-in is temporarily unavailable." },
      { status: 500 },
    );
  }
}

export const POST = withRequestContext(postHandler);
