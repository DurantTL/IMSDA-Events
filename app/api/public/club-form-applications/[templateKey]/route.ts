import { withRequestContext } from "@/lib/request-context";
import { requireTurnstile, TURNSTILE_ACTIONS } from "@/modules/security/turnstile";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubFormApiError } from "@/modules/club-forms/api-errors";
import { resolveOpenApplication, submitOpenApplication } from "@/modules/club-forms/open-applications";
import { openApplicationSubmitSchema } from "@/modules/club-forms/open-applications-domain";
import { applyRateLimitHeaders, type RateLimitOutcome } from "@/modules/rate-limit/domain";
import { checkClubFormApplicationRateLimit } from "@/modules/rate-limit/service";

/**
 * A club form's public open application (#1229): no account, no token. GET returns the form and the club choices
 * (id and name only); POST submits one application. An unknown key and a form that is not an open application both
 * get the same 404. The response to a submit carries only the confirmation message: no club data, no submission id.
 */

const maximumBodyBytes = 300_000;
const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

type RouteContext = { params: Promise<{ templateKey: string }> };

function json(body: unknown, init: ResponseInit = {}, rateLimit?: RateLimitOutcome) {
  const response = Response.json(body, { ...init, headers: { ...privateHeaders, ...init.headers } });
  return rateLimit ? applyRateLimitHeaders(response, rateLimit) : response;
}

function limited(rateLimit: RateLimitOutcome) {
  return json({ error: "RATE_LIMITED", message: "Too many requests. Try again later." }, { status: 429 }, rateLimit);
}

function failure(error: unknown, action: string, rateLimit?: RateLimitOutcome) {
  const response = clubFormApiError(error, action);
  for (const [name, value] of Object.entries(privateHeaders)) response.headers.set(name, value);
  return rateLimit ? applyRateLimitHeaders(response, rateLimit) : response;
}

async function getHandler(request: Request, context: RouteContext) {
  let rateLimit: RateLimitOutcome | undefined;
  try {
    const { templateKey } = await context.params;
    rateLimit = await checkClubFormApplicationRateLimit(request, templateKey, "read");
    if (!rateLimit.allowed) return limited(rateLimit);
    return json(await resolveOpenApplication(templateKey), undefined, rateLimit);
  } catch (error) {
    return failure(error, "Opening a club form application", rateLimit);
  }
}

async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  let rateLimit: RateLimitOutcome | undefined;
  try {
    const { templateKey } = await context.params;
    rateLimit = await checkClubFormApplicationRateLimit(request, templateKey, "submit");
    if (!rateLimit.allowed) return limited(rateLimit);
    if (Number(request.headers.get("content-length") ?? 0) > maximumBodyBytes) {
      return json({ error: "REQUEST_TOO_LARGE", message: "The form is too large." }, { status: 413 }, rateLimit);
    }
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > maximumBodyBytes) {
      return json({ error: "REQUEST_TOO_LARGE", message: "The form is too large." }, { status: 413 }, rateLimit);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return json({ error: "INVALID_JSON_BODY", message: "Send a JSON request body." }, { status: 400 }, rateLimit);
    }
    const input = openApplicationSubmitSchema.parse(parsed);
    const securityCheckFailure = await requireTurnstile(request, { action: TURNSTILE_ACTIONS.clubApplication });
    if (securityCheckFailure) return applyRateLimitHeaders(securityCheckFailure, rateLimit);
    const result = await submitOpenApplication(templateKey, input);
    // The submission id stays inside; the applicant only needs to know it worked.
    return json({ ok: true, confirmationMessage: result.confirmationMessage }, { status: 201 }, rateLimit);
  } catch (error) {
    return failure(error, "Submitting a club form application", rateLimit);
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
