import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { readRosterJson } from "@/modules/club-rosters/api-errors";
import { clubCalendarRateLimitKey, requireClubCalendarWriteAccess } from "@/modules/club-calendar/access";
import { clubCalendarApiError } from "@/modules/club-calendar/api-errors";
import { deleteClubCalendarItem, updateClubCalendarItem } from "@/modules/club-calendar/repository";
import { clubCalendarItemSchema } from "@/modules/club-calendar/schemas";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkClubCalendarRateLimit } from "@/modules/rate-limit/service";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ organizationId: string; itemId: string }> };

/** The club's director or deputy changes one of their own club's calendar items (#1700). Audited. */
async function patchHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, itemId } = await context.params;
    const { access, actor } = await requireClubCalendarWriteAccess(organizationId);
    const rateLimit = await checkClubCalendarRateLimit(request, clubCalendarRateLimitKey(actor), organizationId);
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json({ error: "RATE_LIMITED", message: "Too many changes. Try again later." }, { status: 429 }), rateLimit);
    }
    const input = clubCalendarItemSchema.parse(await readRosterJson(request));
    const item = await updateClubCalendarItem(organizationId, itemId, input, access.capabilities, actor);
    return applyRateLimitHeaders(Response.json({ item }), rateLimit);
  } catch (error) {
    return clubCalendarApiError(error, "Changing a club calendar item");
  }
}

/** The club's director or deputy deletes one of their own club's calendar items (#1700). Audited. */
async function deleteHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, itemId } = await context.params;
    const { access, actor } = await requireClubCalendarWriteAccess(organizationId);
    const rateLimit = await checkClubCalendarRateLimit(request, clubCalendarRateLimitKey(actor), organizationId);
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json({ error: "RATE_LIMITED", message: "Too many changes. Try again later." }, { status: 429 }), rateLimit);
    }
    await deleteClubCalendarItem(organizationId, itemId, access.capabilities, actor);
    return applyRateLimitHeaders(Response.json({ deleted: true }), rateLimit);
  } catch (error) {
    return clubCalendarApiError(error, "Deleting a club calendar item");
  }
}

export const PATCH = withRequestContext(patchHandler);
export const DELETE = withRequestContext(deleteHandler);
