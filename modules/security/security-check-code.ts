import "server-only";

import { after } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import { processAccountEmailQueue } from "@/modules/communications/email-delivery";
import { checkSecurityCheckCodeSendRateLimit } from "@/modules/rate-limit/service";
import type { RateLimitOutcome } from "@/modules/rate-limit/domain";
import { queueSecurityCheckCodeEmail } from "@/modules/security/security-check-code-email";
import {
  attachSecurityCheckCode,
  auditSecurityCheckCodeSent,
  beginSecurityCheckCode,
  bindSecurityCheckCodeMessage,
  hashSecurityCheckEmail,
  normalizeSecurityCheckEmail,
  type SecurityCheckCodeAction,
} from "@/modules/security/security-check-code-store";
import { TURNSTILE_ACTIONS } from "@/modules/security/turnstile";

export { SECURITY_CHECK_CODE_HEADER, isSecurityCheckCodeAction, verifySecurityCheckCode } from "@/modules/security/security-check-code-store";

/**
 * "Email me a code instead" (#1480): a one-time code to an address, sent only when the form it is for would act on
 * that address. The caller always answers with the same 202 body (`SECURITY_CHECK_CODE_ACCEPTED_MESSAGE`), so neither
 * the status, the wording nor the work done before answering says whether an account exists. The only difference is the
 * inbox. Delivery runs after the response, from the outbox, as every other attendee email does.
 */

export const SECURITY_CHECK_CODE_ACCEPTED_MESSAGE = "If that address can use this, we sent a code. It works for 10 minutes.";

/** Whether the form this action belongs to would do anything with this address. Sign-up always does. */
async function addressCanUseAction(action: SecurityCheckCodeAction, email: string) {
  if (action === TURNSTILE_ACTIONS.attendeeSignUp) return true;
  const prisma = getPrisma();
  const address = normalizeSecurityCheckEmail(email);
  const staff = async () => Boolean(await prisma.user.findFirst({
    where: { email: { equals: address, mode: "insensitive" }, accountStatus: "ACTIVE" },
    select: { id: true },
  }));
  const attendee = async () => Boolean(await prisma.attendeeAccount.findFirst({
    where: { email: { equals: address, mode: "insensitive" }, status: "ACTIVE", disabledAt: null },
    select: { id: true },
  }));
  if (action === TURNSTILE_ACTIONS.attendeeSignIn) return attendee();
  if (action === TURNSTILE_ACTIONS.forgotPassword) return (await staff()) || (await attendee());
  // Staff sign-in. The one sign-in page (/sign-in) uses the same action for staff and registrants while it is on.
  if (await staff()) return true;
  return (await isUnifiedSignInEnabled()) && attendee();
}

async function deliverAfterResponse(messageId: string) {
  try {
    await processAccountEmailQueue({ messageIds: [messageId], limit: 1 });
  } catch (error) {
    // Queued is what matters. The sweep will try again.
    logError("A security check code email could not be delivered after the response.", error, { messageId });
  }
}

export type SecurityCheckCodeRequestResult =
  | { rateLimited: true; rateLimit: RateLimitOutcome }
  | { rateLimited: false; rateLimit: RateLimitOutcome; developmentCode?: string };

export async function requestSecurityCheckCode(input: {
  request: Request;
  action: SecurityCheckCodeAction;
  email: string;
}): Promise<SecurityCheckCodeRequestResult> {
  const rateLimit = await checkSecurityCheckCodeSendRateLimit(input.request, input.email);
  if (!rateLimit.allowed) return { rateLimited: true, rateLimit };

  // The same work in the same order for every address: a pending row is opened either way. Only a deliverable one
  // is bound to a message, so an unknown address ends with a row nothing can ever fill or spend.
  const pending = await beginSecurityCheckCode(input.action, hashSecurityCheckEmail(input.email));
  if (!await addressCanUseAction(input.action, input.email)) return { rateLimited: false, rateLimit };

  const dispatch = await queueSecurityCheckCodeEmail({ codeId: pending.id, email: input.email });
  if (dispatch.messageId) {
    const messageId = dispatch.messageId;
    after(() => deliverAfterResponse(messageId));
    await auditSecurityCheckCodeSent(pending.id, input.action);
    return { rateLimited: false, rateLimit };
  }

  // No account email configured. Production cannot get here (the startup contract requires it); a development
  // deployment gets the code in the response, the way #1410's does.
  if (process.env.NODE_ENV === "production") return { rateLimited: false, rateLimit };
  const developmentMessageId = `development:security-check-code:${pending.id}`;
  if (!await bindSecurityCheckCodeMessage(pending.id, developmentMessageId)) return { rateLimited: false, rateLimit };
  const developmentCode = await attachSecurityCheckCode({ messageId: developmentMessageId, now: new Date() });
  if (developmentCode) await auditSecurityCheckCodeSent(pending.id, input.action);
  return { rateLimited: false, rateLimit, developmentCode: developmentCode ?? undefined };
}
