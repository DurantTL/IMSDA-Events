import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { publicRegistrationInputSchema } from "@/modules/forms/public-domain";
import { generalLinkApiError } from "@/modules/general-link-registrations/api-errors";
import { generalLinkExtrasSchema, GENERAL_LINK_RATE_LIMIT_FORM } from "@/modules/general-link-registrations/domain";
import { getGeneralLinkExperience, submitGeneralLinkRegistration } from "@/modules/general-link-registrations/repository";
import { applyRateLimitHeaders, trustedClientIpAddress, type RateLimitOutcome } from "@/modules/rate-limit/domain";
import { checkPublicRegistrationRateLimit } from "@/modules/rate-limit/service";
import { withRequestContext } from "@/lib/request-context";

const maximumBodyBytes = 512 * 1024;
const noStoreHeaders = { "Cache-Control": "no-store" };

type Context = { params: Promise<{ eventSlug: string }> };

/** What the public "register without an account" page needs: the form, the sites and the team rules in words. */
async function getHandler(_request: Request, context: Context) {
  try {
    const { eventSlug } = await context.params;
    return Response.json({ experience: await getGeneralLinkExperience(eventSlug) }, { headers: noStoreHeaders });
  } catch (error) {
    return generalLinkApiError(error, "Loading the team registration");
  }
}

/**
 * Registers a team through the event's general link. Anonymous by design, so it is same-origin only, rate limited, size capped,
 * and the honeypot field is part of the same input schema the ordinary public form uses. Every rule (the club match, the team
 * size, alternate and age rules, the unique team name, the site's dates) is the server's.
 */
async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  let rateLimit: RateLimitOutcome | undefined;
  try {
    const { eventSlug } = await context.params;
    rateLimit = await checkPublicRegistrationRateLimit(request, eventSlug, GENERAL_LINK_RATE_LIMIT_FORM);
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(
        Response.json({ error: "RATE_LIMITED", message: "Too many registration attempts. Try again later." }, { status: 429, headers: noStoreHeaders }),
        rateLimit,
      );
    }
    const body = await request.text();
    if (Buffer.byteLength(body) > maximumBodyBytes) {
      return applyRateLimitHeaders(
        Response.json({ error: "REQUEST_TOO_LARGE", message: "This registration request is too large." }, { status: 413, headers: noStoreHeaders }),
        rateLimit,
      );
    }
    // The site and the team name travel beside the form answers, never inside them.
    const { locationId, teamName, ...answers } = generalLinkExtrasSchema.loose().parse(JSON.parse(body)) as Record<string, unknown> & { locationId?: string | null; teamName?: string | null };
    const input = publicRegistrationInputSchema.parse(answers);
    const confirmation = await submitGeneralLinkRegistration(eventSlug, input, { locationId: locationId ?? null, teamName: teamName ?? null, requestContext: { userAgent: request.headers.get("user-agent"), ipAddress: trustedClientIpAddress(request) } });
    return applyRateLimitHeaders(Response.json({ confirmation }, { status: 201, headers: noStoreHeaders }), rateLimit);
  } catch (error) {
    const response = generalLinkApiError(error, "Submitting the team registration");
    return rateLimit ? applyRateLimitHeaders(response, rateLimit) : response;
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
