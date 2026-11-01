import { z } from "zod";
import { withRequestContext } from "@/lib/request-context";
import { requireTurnstile, TURNSTILE_ACTIONS } from "@/modules/security/turnstile";
import { logError } from "@/lib/logger";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { attendeeSignInStepPending } from "@/modules/attendee-accounts/portal-second-step";
import { InformationFormError } from "@/modules/information-forms/errors";
import { publicInformationFormKey, resolvePublicInformationForm } from "@/modules/information-forms/public";
import { storeInformationFormResponse } from "@/modules/information-forms/responses";
import { applyRateLimitHeaders, mergeRateLimitOutcomes, type RateLimitOutcome } from "@/modules/rate-limit/domain";
import { checkInformationFormClientRateLimit, checkInformationFormRateLimit } from "@/modules/rate-limit/service";

/**
 * Submitting a public information form (#1150). The form is found by its public address (never by an id from the
 * client), the answers are checked against its published version, and the same idempotency key stores once. The
 * answering account is only ever the verified attendee session, never anything in the body. No answer is logged or
 * echoed back, in success or in error.
 */

const maximumBodyBytes = 200_000;
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", "X-Robots-Tag": "noindex, nofollow, noarchive" };

const bodySchema = z.object({
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/),
  eventSlug: z.string().trim().min(1).max(160).regex(/^[a-z0-9-]+$/).optional(),
  idempotencyKey: z.string().trim().min(8).max(100),
  answers: z.record(z.string(), z.unknown()),
}).strict();

function json(body: unknown, status: number, rateLimit?: RateLimitOutcome) {
  const response = Response.json(body, { status, headers: privateHeaders });
  return rateLimit ? applyRateLimitHeaders(response, rateLimit) : response;
}

function limited(rateLimit: RateLimitOutcome) {
  return json({ error: "RATE_LIMITED", message: "Too many answers sent from here. Try again in a few minutes." }, 429, rateLimit);
}

/** The body as text, or null once it passes `limit` bytes; never holds more than the limit. */
async function readCapped(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The verified attendee account of this browser, or null (also null while a required second step is pending). */
async function verifiedAccountId() {
  const { account } = await getCurrentAttendee();
  if (!account || (await attendeeSignInStepPending())) return null;
  return account.id;
}

async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  let rateLimit: RateLimitOutcome | undefined;
  try {
    // The per-client budget is charged before anything is read.
    const clientLimit = await checkInformationFormClientRateLimit(request, "submit");
    rateLimit = clientLimit;
    if (!clientLimit.allowed) return limited(rateLimit);
    // The size cap needs a declared length, and the body is read through a capped reader so a lying or chunked
    // request can never be buffered whole.
    const declaredLength = request.headers.get("content-length");
    if (declaredLength === null || !/^\d+$/.test(declaredLength)) {
      return json({ error: "LENGTH_REQUIRED", message: "The request must state its size." }, 411, rateLimit);
    }
    if (Number(declaredLength) > maximumBodyBytes) return json({ error: "REQUEST_TOO_LARGE", message: "The form is too large." }, 413, rateLimit);
    const text = await readCapped(request, maximumBodyBytes);
    if (text === null) return json({ error: "REQUEST_TOO_LARGE", message: "The form is too large." }, 413, rateLimit);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return json({ error: "INVALID_JSON_BODY", message: "Send a JSON request body." }, 400, rateLimit);
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return json({ error: "INVALID_REQUEST", message: "The request is not valid." }, 400, rateLimit);
    const { slug, eventSlug, idempotencyKey, answers } = parsed.data;
    const target = { slug, ...(eventSlug ? { eventSlug } : {}) };

    const pairLimit = await checkInformationFormRateLimit(request, publicInformationFormKey(target), "submit");
    rateLimit = mergeRateLimitOutcomes(clientLimit, pairLimit);
    if (!pairLimit.allowed) return limited(rateLimit);

    const securityCheckFailure = await requireTurnstile(request, { action: TURNSTILE_ACTIONS.informationForm });
    if (securityCheckFailure) {
      for (const [name, value] of Object.entries(privateHeaders)) securityCheckFailure.headers.set(name, value);
      return applyRateLimitHeaders(securityCheckFailure, rateLimit);
    }

    const view = await resolvePublicInformationForm(target);
    if (view.state === "NOT_FOUND") return json({ error: "FORM_NOT_FOUND", message: "That form was not found." }, 404, rateLimit);

    // The account is only ever the verified session, and is stored only for a form that asks people to sign in:
    // "anyone with the link" responses stay unlinked even when the visitor happens to be signed in.
    const signedInForm = view.state === "OPEN" && view.form.fillAccess === "SIGNED_IN";
    const attendeeAccountId = signedInForm ? await verifiedAccountId() : null;
    if (signedInForm && !attendeeAccountId) {
      return json({ error: "SIGN_IN_REQUIRED", message: "Sign in to answer this form." }, 401, rateLimit);
    }

    // A retry of an answer already stored still reports success after the form closes: the store call is idempotent
    // and decides openness itself, so it is asked even for a closed form.
    const formId = view.state === "OPEN" ? view.form.id : view.id;
    await storeInformationFormResponse({ formId, idempotencyKey, answers, attendeeAccountId });
    // The response id stays inside; the filler only needs to know it worked.
    return json({ ok: true, confirmationMessage: view.state === "OPEN" ? view.form.definition.confirmationMessage : "" }, 201, rateLimit);
  } catch (error) {
    if (error instanceof InformationFormError) {
      const issues = error.issues?.map((issue) => ({ key: issue.key, message: issue.message }));
      return json({ error: error.code, message: error.message, ...(issues ? { issues } : {}) }, error.status, rateLimit);
    }
    // Only the failure is logged; the request body (the answers) is never part of it.
    logError("Information form submission failed", error);
    return json({ error: "SUBMISSION_FAILED", message: "Your answers could not be sent. Please try again." }, 500, rateLimit);
  }
}

export const POST = withRequestContext(postHandler);
