import { z } from "zod";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { logError } from "@/lib/logger";
import { getReleaseIdentity } from "@/lib/release";
import { withRequestContext } from "@/lib/request-context";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkProblemReportRateLimit } from "@/modules/rate-limit/service";
import { turnstileSiteKeyForPage, requireTurnstile, TURNSTILE_ACTIONS } from "@/modules/security/turnstile";
import {
  PROBLEM_REPORT_FAILED_TEXT,
  problemReportInputSchema,
} from "@/modules/support/problem-report-domain";
import { createProblemReport, storedProblemReportDetails } from "@/modules/support/problem-reports";

/**
 * Report a problem from the Forms help popup (#1483). Public: anyone who hits a problem can send one, signed in or not.
 *
 * GET gives the popup what it cannot know on its own: the public Security check site key (null while the check is off)
 * and the signed-in person's email to prefill. Never a secret.
 *
 * POST order: same-origin, the body (its hidden `website` field is the honeypot, checked before the Security check
 * fallback can apply), the rate limit, the Security check with the #1480 fallback for a blocked check, then the write.
 * Only the known technical-detail fields are kept (see problem-report-domain.ts).
 */

async function getHandler() {
  let email: string | null = null;
  try {
    const { user } = await getCurrentSession();
    email = user?.email ?? null;
    if (!email) email = (await getCurrentAttendee()).account?.verifiedEmail ?? null;
  } catch (error) {
    logError("The problem report popup could not read the signed-in email", error);
  }
  return Response.json({ siteKey: turnstileSiteKeyForPage(), email });
}

async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const input = problemReportInputSchema.parse(await request.json().catch(() => ({})));

    const rateLimit = await checkProblemReportRateLimit(request, input.email);
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(
        Response.json({ error: "RATE_LIMITED", message: "Too many reports from here. Try again in an hour, or email the help address." }, { status: 429 }),
        rateLimit,
      );
    }

    const securityCheckFailure = await requireTurnstile(request, {
      action: TURNSTILE_ACTIONS.problemReport,
      fallback: { kind: "public-form", email: input.email ?? null },
    });
    if (securityCheckFailure) return applyRateLimitHeaders(securityCheckFailure, rateLimit);

    let userId: string | null = null;
    try {
      userId = (await getCurrentSession()).user?.id ?? null;
    } catch {
      userId = null;
    }
    const release = getReleaseIdentity();
    const created = await createProblemReport({
      message: input.message,
      email: input.email ?? null,
      userId,
      details: input.details ? storedProblemReportDetails(input.details, release.sha?.slice(0, 12) ?? release.buildId) : null,
    });
    return applyRateLimitHeaders(Response.json({ reference: created.reference }, { status: 201 }), rateLimit);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "INVALID_PROBLEM_REPORT", message: error.issues[0]?.message ?? "Check the report and try again." }, { status: 400 });
    }
    logError("Problem report failed", error);
    return Response.json({ error: "PROBLEM_REPORT_FAILED", message: PROBLEM_REPORT_FAILED_TEXT }, { status: 500 });
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
