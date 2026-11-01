import "server-only";

import { after } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import { processAccountEmailQueue } from "@/modules/communications/email-delivery";
import { checkSecurityCheckCodeSendRateLimit } from "@/modules/rate-limit/service";
import type { RateLimitOutcome } from "@/modules/rate-limit/domain";
import { isSecurityCheckEmailConfigured, queueSecurityCheckCodeEmail } from "@/modules/security/security-check-code-email";
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
 * the status, the wording nor the work done before answering says whether an account exists: the eligibility check, the
 * outbox write, the audit entry and the delivery all run after the response. The only difference is the inbox.
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

/** Everything that differs between a known and an unknown address. Runs after the response; never throws. */
async function sendForEligibleAddress(codeId: string, action: SecurityCheckCodeAction, email: string) {
  try {
    if (!await addressCanUseAction(action, email)) return;
    const dispatch = await queueSecurityCheckCodeEmail({ codeId, email });
    if (!dispatch.messageId) return;
    await auditSecurityCheckCodeSent(codeId, action);
    await deliverAfterResponse(dispatch.messageId);
  } catch (error) {
    // Ids only: never the address.
    logError("A security check code could not be queued", error, { codeId, checkAction: action });
  }
}

/** Non-production with no account email configured: the code comes back in the response, as #1410's does. */
async function developmentCodeFor(codeId: string, action: SecurityCheckCodeAction, email: string) {
  try {
    if (!await addressCanUseAction(action, email)) return undefined;
    const messageId = `development:security-check-code:${codeId}`;
    if (!await bindSecurityCheckCodeMessage(codeId, messageId)) return undefined;
    // sealSecret needs SECRET_ENCRYPTION_KEY; without it there is simply no development code, never a 500.
    const code = await attachSecurityCheckCode({ messageId, now: new Date() });
    if (code) await auditSecurityCheckCodeSent(codeId, action);
    return code ?? undefined;
  } catch (error) {
    logError("A development security check code could not be minted", error, { codeId, checkAction: action });
    return undefined;
  }
}

/**
 * The work before the response is the same for every address: the rate limit, then one pending row. The lookup, the
 * outbox write, the audit entry and the delivery all run after the response and swallow their own errors, so neither
 * the status, the timing nor a failing write can say whether an account exists.
 */
export async function requestSecurityCheckCode(input: {
  request: Request;
  action: SecurityCheckCodeAction;
  email: string;
}): Promise<SecurityCheckCodeRequestResult> {
  const rateLimit = await checkSecurityCheckCodeSendRateLimit(input.request, input.email, input.action);
  if (!rateLimit.allowed) return { rateLimited: true, rateLimit };

  const pending = await beginSecurityCheckCode(input.action, hashSecurityCheckEmail(input.email));
  if (!isSecurityCheckEmailConfigured()) {
    // Production cannot get here (the startup contract requires account email).
    if (process.env.NODE_ENV === "production") return { rateLimited: false, rateLimit };
    return { rateLimited: false, rateLimit, developmentCode: await developmentCodeFor(pending.id, input.action, input.email) };
  }
  after(() => sendForEligibleAddress(pending.id, input.action, input.email));
  return { rateLimited: false, rateLimit };
}
