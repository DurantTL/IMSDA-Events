import "server-only";

import { after } from "next/server";
import { logError } from "@/lib/logger";
import { getPrisma } from "@/lib/prisma";
import { hashOpaqueToken } from "@/modules/access/tokens";
import { mintAttendeeCodeWithoutSending } from "@/modules/attendee-accounts/attendee-email";
import {
  deliverQueuedAttendeeEmail,
  queueAttendeeSignInCodeEmail,
} from "@/modules/attendee-accounts/attendee-email-dispatch";
import { beginAttendeeSignInCode } from "@/modules/attendee-accounts/sign-in-code-service";
import { accountNeedsSignInStep } from "@/modules/attendee-accounts/sign-in-gate";
import { bindAttendeeStepUpMessage } from "@/modules/attendee-accounts/step-up-service";
import type { RateLimitOutcome } from "@/modules/rate-limit/domain";
import { checkAttendeeSignInCodeSendRateLimit } from "@/modules/rate-limit/service";

export type IssuedSignInCode = {
  /** Whether a message was queued (or, in development with no email configured, a code minted). */
  sent: boolean;
  /** The send budget decided no. The person can try again later from the code page. */
  rateLimited: boolean;
  rateLimit: RateLimitOutcome;
  /** Non-production with no email configured only, as for the edit code. Never set in production. */
  developmentCode?: string;
};

/**
 * Sends the sign-in code for this session: retires earlier unspent codes, queues the email, and delivers
 * it after the response. The code itself is minted at delivery and is never held here.
 */
export async function issueSignInCode(input: {
  request: Request;
  accountId: string;
  sessionId: string;
  email: string;
  displayName: string;
}): Promise<IssuedSignInCode> {
  const rateLimit = await checkAttendeeSignInCodeSendRateLimit(input.request, input.accountId);
  if (!rateLimit.allowed) return { sent: false, rateLimited: true, rateLimit };

  const pending = await beginAttendeeSignInCode(input.accountId, input.sessionId);
  const dispatch = await queueAttendeeSignInCodeEmail({
    accountId: input.accountId,
    stepUpCodeId: pending.id,
    email: input.email,
    displayName: input.displayName,
  });
  if (dispatch.messageId) {
    const messageId = dispatch.messageId;
    after(() => deliverQueuedAttendeeEmail(messageId));
    return { sent: true, rateLimited: false, rateLimit };
  }

  // No account email configured. Production cannot get here (the startup contract requires it); a development
  // deployment gets the code in the response, the way the edit code does.
  if (process.env.NODE_ENV === "production") return { sent: false, rateLimited: false, rateLimit };
  const developmentMessageId = `development:sign-in-code:${pending.id}`;
  await bindAttendeeStepUpMessage(pending.id, developmentMessageId);
  const developmentCode = await mintAttendeeCodeWithoutSending({
    accountId: input.accountId,
    purpose: "sign-in-code",
    messageId: developmentMessageId,
  });
  return { sent: Boolean(developmentCode), rateLimited: false, rateLimit, developmentCode: developmentCode ?? undefined };
}

/**
 * Right after a sign-in route created a session: whether that session now owes the emailed code, and if so
 * sends it. Looks the session up by its token hash, so it covers whichever route issued it. Reveals nothing
 * before the password was right, because routes call it only after a session exists.
 */
export async function startSignInCodeIfRequired(input: {
  request: Request;
  accountId: string;
  sessionToken: string;
}): Promise<{ required: false } | ({ required: true } & Pick<IssuedSignInCode, "sent" | "developmentCode">)> {
  const session = await getPrisma().attendeeSession.findUnique({
    where: { tokenHash: hashOpaqueToken(input.sessionToken) },
    select: { id: true },
  });
  if (!session) return { required: false };
  if ((await accountNeedsSignInStep(input.accountId, session.id)) !== "EMAIL_CODE") return { required: false };
  const account = await getPrisma().attendeeAccount.findUnique({
    where: { id: input.accountId },
    select: { email: true, displayName: true },
  });
  if (!account) return { required: false };
  try {
    const issued = await issueSignInCode({
      request: input.request,
      accountId: input.accountId,
      sessionId: session.id,
      email: account.email,
      displayName: account.displayName,
    });
    return { required: true, sent: issued.sent, developmentCode: issued.developmentCode };
  } catch (error) {
    // The session already owes the code, so nothing is opened by a failed send; the code page offers "Send a new code".
    logError("The sign-in code could not be sent after sign-in", error);
    return { required: true, sent: false };
  }
}
