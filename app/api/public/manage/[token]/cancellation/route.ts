import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { privateJson, readBoundedBody, registrantAction, registrantView, requestError } from "@/modules/cancellation-requests/api";
import { authorizeRegistrationAccessToken } from "@/modules/public-access/repository";
import { applyRateLimitHeaders, type RateLimitOutcome } from "@/modules/rate-limit/domain";
import { checkPublicManageRateLimit } from "@/modules/rate-limit/service";
import { withRequestContext } from "@/lib/request-context";

/**
 * Cancellation requests from the private manage link (#170). The token names the registration; the target comes from
 * it, never from the body. A request is only a request: nothing here cancels, refunds or credits anything.
 */

type Context = { params: Promise<{ token: string }> };

function unavailable(rateLimit?: RateLimitOutcome) {
  const response = privateJson(
    { error: "REGISTRATION_ACCESS_UNAVAILABLE", message: "This private registration link is invalid or no longer active." },
    { status: 404 },
  );
  return rateLimit ? applyRateLimitHeaders(response, rateLimit) : response;
}

function limited(rateLimit: RateLimitOutcome) {
  return applyRateLimitHeaders(
    privateJson({ error: "RATE_LIMITED", message: "Too many requests for this private registration link. Try again later." }, { status: 429 }),
    rateLimit,
  );
}

async function getHandler(request: Request, context: Context) {
  let rateLimit: RateLimitOutcome | undefined;
  try {
    const { token } = await context.params;
    rateLimit = await checkPublicManageRateLimit(request, token, "read");
    if (!rateLimit.allowed) return limited(rateLimit);
    const access = await authorizeRegistrationAccessToken(token);
    if (!access) return unavailable(rateLimit);
    return applyRateLimitHeaders(await registrantView({ registrationId: access.registrationId, eventId: access.eventId }), rateLimit);
  } catch (error) {
    return requestError(error, "Loading cancellation requests");
  }
}

async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  let rateLimit: RateLimitOutcome | undefined;
  try {
    const { token } = await context.params;
    rateLimit = await checkPublicManageRateLimit(request, token, "update");
    if (!rateLimit.allowed) return limited(rateLimit);
    const access = await authorizeRegistrationAccessToken(token);
    if (!access) return unavailable(rateLimit);
    const read = await readBoundedBody(request);
    if ("response" in read) return applyRateLimitHeaders(read.response, rateLimit);
    const response = await registrantAction(
      { registrationId: access.registrationId, eventId: access.eventId },
      { via: "MANAGE_LINK" },
      read.body,
    );
    return applyRateLimitHeaders(response, rateLimit);
  } catch (error) {
    return requestError(error, "Saving a cancellation request");
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
