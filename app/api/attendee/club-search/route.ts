import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { CLUB_SEARCH_REQUESTS_PER_MINUTE } from "@/modules/club-search/domain";
import { clubSearchRateLimitKey, getClubSearchViewer, searchClubPortal } from "@/modules/club-search/service";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkClubSearchRateLimit } from "@/modules/rate-limit/service";

/**
 * GET /api/attendee/club-search?q= (#1854): the club portal search's clubs and members. Club leaders only (an attendee
 * account, or a staff act-as as a club director); what each group returns is decided in `modules/club-search/service.ts`.
 * Answers are never cached.
 */
async function getHandler(request: Request) {
  const headers = { "cache-control": "no-store" };
  try {
    const viewer = await getClubSearchViewer();
    if (!viewer) {
      return Response.json({ error: "AUTHENTICATION_REQUIRED", message: "Sign in to your club first." }, { status: 401, headers });
    }
    const outcome = await checkClubSearchRateLimit(clubSearchRateLimitKey(viewer), CLUB_SEARCH_REQUESTS_PER_MINUTE);
    if (!outcome.allowed) {
      return applyRateLimitHeaders(
        Response.json({ error: "RATE_LIMITED", message: "Too many searches. Wait a moment and try again." }, { status: 429, headers }),
        outcome,
      );
    }
    const result = await searchClubPortal(viewer, new URL(request.url).searchParams.get("q"));
    return Response.json(result, { headers });
  } catch (error) {
    logError("Club portal search failed", error);
    return Response.json({ error: "SEARCH_FAILED", message: "Search is not available right now." }, { status: 500, headers });
  }
}

export const GET = withRequestContext(getHandler);
