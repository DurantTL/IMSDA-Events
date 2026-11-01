import { z } from "zod";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { honeypotFieldSchema } from "@/modules/security/honeypot";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import {
  SECURITY_CHECK_CODE_ACCEPTED_MESSAGE,
  requestSecurityCheckCode,
} from "@/modules/security/security-check-code";
import { SECURITY_CHECK_CODE_ACTIONS } from "@/modules/security/security-check-code-store";

/**
 * "Email me a code instead" (#1480): the way past a blocked Security check on the sign-in, sign-up and password reset
 * forms. The answer is the same 202 and the same words whether or not the address has an account; a code is emailed
 * only when the form would act on that address. A code only satisfies the human check for one request (the form
 * sends it in `x-security-check-code`); it never signs anyone in.
 */

const bodySchema = z.object({
  action: z.enum(SECURITY_CHECK_CODE_ACTIONS),
  email: z.string().trim().email().max(254),
  // The honeypot: the form sends it empty, a script that fills every field does not.
  website: honeypotFieldSchema,
}).strict();

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const input = bodySchema.parse(await request.json());
    const result = await requestSecurityCheckCode({ request, action: input.action, email: input.email });
    if (result.rateLimited) {
      return applyRateLimitHeaders(Response.json(
        { error: "RATE_LIMITED", message: "Too many code requests. Try again in a little while, or contact the conference office." },
        { status: 429, headers: noStore },
      ), result.rateLimit);
    }
    return applyRateLimitHeaders(Response.json(
      { ok: true, message: SECURITY_CHECK_CODE_ACCEPTED_MESSAGE, developmentCode: result.developmentCode },
      { status: 202, headers: noStore },
    ), result.rateLimit);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ error: "INVALID_REQUEST", message: "Enter a valid email address." }, { status: 400, headers: noStore });
    }
    logError("Security check code request failed", error);
    return Response.json({ error: "CODE_REQUEST_FAILED", message: "Codes are temporarily unavailable." }, { status: 500, headers: noStore });
  }
}

export const POST = withRequestContext(postHandler);
