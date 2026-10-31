import { withRequestContext } from "@/lib/request-context";
import { logError } from "@/lib/logger";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { issueSignInCode } from "@/modules/attendee-accounts/sign-in-code-issue";
import { accountNeedsSignInStep } from "@/modules/attendee-accounts/sign-in-gate";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";

/**
 * "Send a new code" on the sign-in code page (#1410). Only for the person's own attendee session while it still
 * owes the emailed code; the code page itself never sends on GET. A new code retires the earlier ones.
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { account, via, sessionId } = await getCurrentAttendee();
    if (!account || via !== "attendee" || !sessionId) {
      return Response.json(
        { error: "SIGN_IN_REQUIRED", message: "Sign in to get a sign-in code." },
        { status: 401 },
      );
    }
    // Nothing is sent to a session that owes no code: no spare mail for a password thief to trigger on someone else's behalf.
    if ((await accountNeedsSignInStep(account.id, sessionId)) !== "EMAIL_CODE") {
      return Response.json({ ok: true, required: false });
    }
    const issued = await issueSignInCode({
      request,
      accountId: account.id,
      sessionId,
      email: account.verifiedEmail,
      displayName: account.displayName,
    });
    if (issued.rateLimited) {
      return applyRateLimitHeaders(Response.json({
        error: "RATE_LIMITED",
        message: "Too many codes requested. Wait a little while, then try again.",
      }, { status: 429 }), issued.rateLimit);
    }
    if (!issued.sent) {
      return applyRateLimitHeaders(Response.json({
        error: "CODE_NOT_SENT",
        message: "We couldn't send a code right now. Try again in a few minutes.",
      }, { status: 503 }), issued.rateLimit);
    }
    return applyRateLimitHeaders(Response.json({
      ok: true,
      required: true,
      message: "We sent a new six-digit code. It works for 10 minutes.",
      developmentCode: issued.developmentCode,
    }), issued.rateLimit);
  } catch (error) {
    logError("Sending the sign-in code failed", error);
    return Response.json(
      { error: "SIGN_IN_CODE_FAILED", message: "Sign-in codes are temporarily unavailable." },
      { status: 500 },
    );
  }
}

export const POST = withRequestContext(postHandler);
