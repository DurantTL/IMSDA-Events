import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { applyRateLimitHeaders, type RateLimitOutcome } from "@/modules/rate-limit/domain";
import { checkPublicRegistrationRateLimit } from "@/modules/rate-limit/service";
import { INVITATION_RATE_LIMIT_FORM } from "@/modules/staff-invitations/domain";
import { readBoundedText, staffInvitationApiError } from "@/modules/staff-invitations/api-errors";
import { submitInvitationRegistration } from "@/modules/staff-invitations/repository";
import { withRequestContext } from "@/lib/request-context";

const maximumBodyBytes = 64 * 1024;
const noStore = { "Cache-Control": "no-store" };

type Context = { params: Promise<{ token: string }> };

/**
 * Registers a person and their family through a personal invitation link (#804). The link is the credential, so this is
 * same-origin only, rate limited, and size capped; every rule (the link, the event, the family, the $0 price) is the server's.
 * The answer names nothing but the reference code.
 */
async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  let rateLimit: RateLimitOutcome | undefined;
  try {
    const { token } = await context.params;
    rateLimit = await checkPublicRegistrationRateLimit(request, "staff-invitations", INVITATION_RATE_LIMIT_FORM);
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(
        Response.json({ error: "RATE_LIMITED", message: "Too many attempts. Try again later." }, { status: 429, headers: noStore }),
        rateLimit,
      );
    }
    const body = await readBoundedText(request, maximumBodyBytes);
    if (body === null) {
      return applyRateLimitHeaders(
        Response.json({ error: "REQUEST_TOO_LARGE", message: "This request is too large." }, { status: 413, headers: noStore }),
        rateLimit,
      );
    }
    const confirmation = await submitInvitationRegistration(token, JSON.parse(body));
    return applyRateLimitHeaders(Response.json({ confirmation }, { status: 201, headers: noStore }), rateLimit);
  } catch (error) {
    const response = staffInvitationApiError(error, "Submitting the registration");
    return rateLimit ? applyRateLimitHeaders(response, rateLimit) : response;
  }
}

export const POST = withRequestContext(postHandler);
