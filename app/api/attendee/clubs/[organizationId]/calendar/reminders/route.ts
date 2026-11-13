import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { readRosterJson } from "@/modules/club-rosters/api-errors";
import { clubCalendarRateLimitKey, requireClubCalendarWriteAccess } from "@/modules/club-calendar/access";
import { clubCalendarApiError } from "@/modules/club-calendar/api-errors";
import { setClubCalendarReminders } from "@/modules/club-calendar/repository";
import { clubCalendarReminderSettingSchema } from "@/modules/club-calendar/schemas";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkClubCalendarRateLimit } from "@/modules/rate-limit/service";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ organizationId: string }> };

/**
 * The club's director or deputy turns the calendar's reminder emails on or off and chooses how many days before they go
 * out (#1700). Off until someone does. Audited.
 */
async function putHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId } = await context.params;
    const { access, actor } = await requireClubCalendarWriteAccess(organizationId);
    const rateLimit = await checkClubCalendarRateLimit(request, clubCalendarRateLimitKey(actor), organizationId);
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json({ error: "RATE_LIMITED", message: "Too many changes. Try again later." }, { status: 429 }), rateLimit);
    }
    const input = clubCalendarReminderSettingSchema.parse(await readRosterJson(request));
    const reminder = await setClubCalendarReminders(organizationId, input, access.capabilities, actor);
    return applyRateLimitHeaders(Response.json({ reminder }), rateLimit);
  } catch (error) {
    return clubCalendarApiError(error, "Changing club calendar reminders");
  }
}

export const PUT = withRequestContext(putHandler);
