import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { AreaReviewError } from "@/modules/club-reports/area-review-domain";
import { itemReviewSchema } from "@/modules/club-reports/area-review-schemas";
import { reviewReportItem } from "@/modules/club-reports/area-review";
import { readRosterJson } from "@/modules/club-rosters/api-errors";
import { requireAreaCoordinatorApprover } from "@/modules/master-guide/access";
import { masterGuideApiError } from "@/modules/master-guide/api-errors";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkMasterGuideWriteRateLimit } from "@/modules/rate-limit/service";
import { withRequestContext } from "@/lib/request-context";

/**
 * An Area Coordinator marks one item of a submitted Monthly Record OK or Returned, with a note (#1701): the one write a
 * coordinator has on a record. Their own attendee account with an active grant and the second sign-in step; staff acting
 * as a coordinator are refused. The club must be of one of the coordinator's ministries and the conference switch must be
 * on. Everyone else gets "not found".
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireAreaCoordinatorApprover();
    const rateLimit = await checkMasterGuideWriteRateLimit(request, `account:${actor.accountId}`, `area-review:${actor.accountId}`);
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json({ error: "RATE_LIMITED", message: "Too many changes. Try again later." }, { status: 429 }), rateLimit);
    }
    const input = itemReviewSchema.parse(await readRosterJson(request));
    const result = await reviewReportItem(input, actor);
    return Response.json({ ok: true, changed: result.changed }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AreaReviewError) {
      const status = error.code === "NOT_FOUND" || error.code === "FEATURE_OFF" ? 404 : error.code === "NOT_SUBMITTED" || error.code === "CONFLICT" ? 409 : 400;
      return Response.json({ error: error.code, message: error.message }, { status });
    }
    return masterGuideApiError(error, "Reviewing the Monthly Record item");
  }
}

export const POST = withRequestContext(postHandler);
