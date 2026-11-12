import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubLettersRateLimitKey, requireClubLettersAccess } from "@/modules/club-letters/access";
import { clubLetterApiError } from "@/modules/club-letters/api-errors";
import { createClubLetter } from "@/modules/club-letters/repository";
import { parseClubLetterCreate } from "@/modules/club-letters/schemas";
import { readRosterJson } from "@/modules/club-rosters/api-errors";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkClubLettersRateLimit } from "@/modules/rate-limit/service";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ organizationId: string }> };

/**
 * The club's director or deputy saves a new fill-in letter or certificate template (#1708). Only while the club has the
 * feature switched on; another club, a registrar, a reporter, an Area Coordinator and staff without an act-as get a
 * refusal. Every add is audited. Nothing is sent to anyone.
 */
async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId } = await context.params;
    const { actor } = await requireClubLettersAccess(organizationId);
    const rateLimit = await checkClubLettersRateLimit(request, clubLettersRateLimitKey(actor), organizationId);
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json({ error: "RATE_LIMITED", message: "Too many changes. Try again later." }, { status: 429 }), rateLimit);
    }
    const input = parseClubLetterCreate(await readRosterJson(request));
    const letter = await createClubLetter(organizationId, input, actor);
    return applyRateLimitHeaders(Response.json({ letter }, { status: 201 }), rateLimit);
  } catch (error) {
    return clubLetterApiError(error, "Adding a club letter");
  }
}

export const POST = withRequestContext(postHandler);
