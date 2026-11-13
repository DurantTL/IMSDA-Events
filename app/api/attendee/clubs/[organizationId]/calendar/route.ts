import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { readRosterJson } from "@/modules/club-rosters/api-errors";
import { clubCalendarRateLimitKey, requireClubCalendarWriteAccess } from "@/modules/club-calendar/access";
import { clubCalendarApiError } from "@/modules/club-calendar/api-errors";
import { addClubCalendarItem } from "@/modules/club-calendar/repository";
import { clubCalendarItemSchema } from "@/modules/club-calendar/schemas";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkClubCalendarRateLimit } from "@/modules/rate-limit/service";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ organizationId: string }> };

/**
 * The club's director or deputy adds a meeting, outing or deadline to the club calendar (#1700). Only while the club has
 * the calendar switched on; another club, a registrar, a reporter, an Area Coordinator and staff without an act-as get a
 * refusal. Every add is audited.
 */
async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId } = await context.params;
    const { access, actor } = await requireClubCalendarWriteAccess(organizationId);
    const rateLimit = await checkClubCalendarRateLimit(request, clubCalendarRateLimitKey(actor), organizationId);
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json({ error: "RATE_LIMITED", message: "Too many changes. Try again later." }, { status: 429 }), rateLimit);
    }
    const input = clubCalendarItemSchema.parse(await readRosterJson(request));
    const item = await addClubCalendarItem(organizationId, input, access.capabilities, actor);
    return applyRateLimitHeaders(Response.json({ item }, { status: 201 }), rateLimit);
  } catch (error) {
    return clubCalendarApiError(error, "Adding a club calendar item");
  }
}

export const POST = withRequestContext(postHandler);
