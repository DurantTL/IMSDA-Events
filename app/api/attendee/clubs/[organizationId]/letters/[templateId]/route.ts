import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubLettersRateLimitKey, requireClubLettersAccess } from "@/modules/club-letters/access";
import { clubLetterApiError } from "@/modules/club-letters/api-errors";
import { deleteClubLetter, updateClubLetter } from "@/modules/club-letters/repository";
import { parseClubLetterUpdate } from "@/modules/club-letters/schemas";
import { readRosterJson } from "@/modules/club-rosters/api-errors";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkClubLettersRateLimit } from "@/modules/rate-limit/service";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ organizationId: string; templateId: string }> };

/** The club's director or deputy changes one of their own club's templates (#1708). Audited. */
async function patchHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, templateId } = await context.params;
    const { actor } = await requireClubLettersAccess(organizationId);
    const rateLimit = await checkClubLettersRateLimit(request, clubLettersRateLimitKey(actor), organizationId);
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json({ error: "RATE_LIMITED", message: "Too many changes. Try again later." }, { status: 429 }), rateLimit);
    }
    const input = parseClubLetterUpdate(await readRosterJson(request));
    const letter = await updateClubLetter(organizationId, templateId, input, actor);
    return applyRateLimitHeaders(Response.json({ letter }), rateLimit);
  } catch (error) {
    return clubLetterApiError(error, "Changing a club letter");
  }
}

/** The club's director or deputy deletes one of their own club's templates (#1708). Audited. */
async function deleteHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, templateId } = await context.params;
    const { actor } = await requireClubLettersAccess(organizationId);
    const rateLimit = await checkClubLettersRateLimit(request, clubLettersRateLimitKey(actor), organizationId);
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json({ error: "RATE_LIMITED", message: "Too many changes. Try again later." }, { status: 429 }), rateLimit);
    }
    await deleteClubLetter(organizationId, templateId, actor);
    return applyRateLimitHeaders(Response.json({ deleted: true }), rateLimit);
  } catch (error) {
    return clubLetterApiError(error, "Deleting a club letter");
  }
}

export const PATCH = withRequestContext(patchHandler);
export const DELETE = withRequestContext(deleteHandler);
