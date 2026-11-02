import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { SIGN_IN_CODE_LIFETIME_MINUTES } from "@/modules/attendee-accounts/codes";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { issueTwoStepRecoveryCode } from "@/modules/attendee-accounts/two-step-recovery-issue";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";

/**
 * "Send me a code" on the lost-device recovery page (#221). Only for the person's own attendee session, which
 * already proved a password or Google. No address is typed, so nothing can be used to find accounts, and the
 * answer is the same words and shape whether or not the account has anything to recover. It never returns a
 * code or hash (the non-production `developmentCode` aside, exactly as the sign-in code does).
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
    const issued = await issueTwoStepRecoveryCode({
      request,
      accountId: account.id,
      sessionId,
      email: account.verifiedEmail,
      displayName: account.displayName,
    });
    if (issued.rateLimited) {
      return applyRateLimitHeaders(Response.json({
        error: "RATE_LIMITED",
        message: "Too many attempts. Wait a little while, then try again.",
      }, { status: 429 }), issued.rateLimit);
    }
    return applyRateLimitHeaders(Response.json({
      ok: true,
      message: `If this account can be recovered, a code is on its way to ${account.verifiedEmail}. It works for ${SIGN_IN_CODE_LIFETIME_MINUTES} minutes.`,
      developmentCode: issued.developmentCode,
    }), issued.rateLimit);
  } catch (error) {
    logError("Sending the two-step recovery code failed", error);
    return Response.json(
      { error: "TWO_STEP_RECOVERY_FAILED", message: "Recovering two-step sign-in is temporarily unavailable." },
      { status: 500 },
    );
  }
}

export const POST = withRequestContext(postHandler);
