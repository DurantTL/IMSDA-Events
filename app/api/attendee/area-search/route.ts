import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { AREA_SEARCH_REQUESTS_PER_MINUTE } from "@/modules/area-search/domain";
import { areaSearchRateLimitKey, getAreaSearchViewer, searchAreaClubs } from "@/modules/area-search/service";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkAreaSearchRateLimit } from "@/modules/rate-limit/service";

/**
 * GET /api/attendee/area-search?q= (#1854): the Area Coordinator search's clubs. Area Coordinators only (the same gate as
 * the area-clubs pages, including a staff act-as); what it returns is decided in `modules/area-search/service.ts`.
 * Answers are never cached.
 */
async function getHandler(request: Request) {
  const headers = { "cache-control": "no-store" };
  try {
    const viewer = await getAreaSearchViewer();
    if (!viewer) {
      return Response.json({ error: "AUTHENTICATION_REQUIRED", message: "Sign in as an Area Coordinator first." }, { status: 401, headers });
    }
    const outcome = await checkAreaSearchRateLimit(areaSearchRateLimitKey(viewer), AREA_SEARCH_REQUESTS_PER_MINUTE);
    if (!outcome.allowed) {
      return applyRateLimitHeaders(
        Response.json({ error: "RATE_LIMITED", message: "Too many searches. Wait a moment and try again." }, { status: 429, headers }),
        outcome,
      );
    }
    const result = await searchAreaClubs(viewer, new URL(request.url).searchParams.get("q"));
    return Response.json(result, { headers });
  } catch (error) {
    logError("Area search failed", error);
    return Response.json({ error: "SEARCH_FAILED", message: "Search is not available right now." }, { status: 500, headers });
  }
}

export const GET = withRequestContext(getHandler);
