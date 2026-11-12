import { z } from "zod";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { withRequestContext } from "@/lib/request-context";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { applyRateLimitHeaders, mergeRateLimitOutcomes, type RateLimitOutcome } from "@/modules/rate-limit/domain";
import { checkVisitingClubLinkRateLimit, checkVisitingClubSubmitRateLimit } from "@/modules/rate-limit/service";
import { visitingClubRequestInputSchema } from "@/modules/visiting-clubs/domain";
import { visitingClubApiError } from "@/modules/visiting-clubs/api-errors";
import { submitVisitingClubRequest } from "@/modules/visiting-clubs/repository";

/**
 * The visiting director's request (#835), from their own signed-in account. The link's token comes in the body; the
 * server re-checks it, the account's verified email and the event, then claims the link once. It creates a waiting
 * request only: no club and no access. Same-origin only (CSRF) and rate limited per client and per account.
 */
const headers = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive" };

function limited(rateLimit: RateLimitOutcome) {
  return applyRateLimitHeaders(
    Response.json({ error: "RATE_LIMITED", message: "Too many requests from here. Try again later." }, { status: 429, headers }),
    rateLimit,
  );
}

async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  let rateLimit: RateLimitOutcome | undefined;
  try {
    const { account, via } = await getCurrentAttendee();
    if (!account || via !== "attendee") {
      return Response.json({ error: "SIGN_IN_REQUIRED", message: "Sign in with your own account to send this request." }, { status: 401, headers });
    }
    rateLimit = await checkVisitingClubSubmitRateLimit(request, account.id);
    if (!rateLimit.allowed) return limited(rateLimit);
    const body = z.looseObject({ token: z.string().trim().min(1).max(200) }).parse(await request.json());
    const { token, ...answers } = body;
    const input = visitingClubRequestInputSchema.parse(answers);
    const linkLimit = await checkVisitingClubLinkRateLimit(request, token);
    rateLimit = mergeRateLimitOutcomes(rateLimit, linkLimit);
    if (!linkLimit.allowed) return limited(rateLimit);
    await submitVisitingClubRequest({ id: account.id, verifiedEmail: account.verifiedEmail, displayName: account.displayName }, token, input);
    // The id stays inside; the director only needs to know it worked.
    return applyRateLimitHeaders(Response.json({ ok: true }, { status: 201, headers }), rateLimit);
  } catch (error) {
    const response = visitingClubApiError(error, "Submitting a visiting club request");
    return rateLimit ? applyRateLimitHeaders(response, rateLimit) : response;
  }
}

export const POST = withRequestContext(postHandler);
