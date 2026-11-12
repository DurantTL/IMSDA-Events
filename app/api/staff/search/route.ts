import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { getCurrentSession } from "@/modules/access/current-session";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkStaffSearchRateLimit } from "@/modules/rate-limit/service";
import { STAFF_SEARCH_REQUESTS_PER_MINUTE } from "@/modules/staff-search/domain";
import { searchStaffRecords } from "@/modules/staff-search/service";

/**
 * GET /api/staff/search?q= (#1837): the header search's clubs, events, churches and people. Signed-in staff only; what each
 * group returns is decided in `modules/staff-search/service.ts`. Answers are never cached.
 */
async function getHandler(request: Request) {
  const headers = { "cache-control": "no-store" };
  const { user } = await getCurrentSession();
  if (!user) {
    return Response.json({ error: "AUTHENTICATION_REQUIRED", message: "Sign in to the staff workspace first." }, { status: 401, headers });
  }
  try {
    const outcome = await checkStaffSearchRateLimit(user.id, STAFF_SEARCH_REQUESTS_PER_MINUTE);
    if (!outcome.allowed) {
      return applyRateLimitHeaders(
        Response.json({ error: "RATE_LIMITED", message: "Too many searches. Wait a moment and try again." }, { status: 429, headers }),
        outcome,
      );
    }
    const result = await searchStaffRecords(user, new URL(request.url).searchParams.get("q"));
    return Response.json(result, { headers });
  } catch (error) {
    logError("Staff record search failed", error);
    return Response.json({ error: "SEARCH_FAILED", message: "Search is not available right now." }, { status: 500, headers });
  }
}

export const GET = withRequestContext(getHandler);
