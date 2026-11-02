import "server-only";

import { after } from "next/server";
import { logError } from "@/lib/logger";
import { getPrisma } from "@/lib/prisma";
import { mintAttendeeCodeWithoutSending } from "@/modules/attendee-accounts/attendee-email";
import {
  deliverQueuedAttendeeEmail,
  queueAttendeeTwoStepRecoveredEmail,
  queueAttendeeTwoStepRecoveryCodeEmail,
} from "@/modules/attendee-accounts/attendee-email-dispatch";
import { accountNeedsSignInStep } from "@/modules/attendee-accounts/sign-in-gate";
import { bindAttendeeStepUpMessage } from "@/modules/attendee-accounts/step-up-service";
import {
  TWO_STEP_RECOVERY_DAILY_LIMIT,
  accountHasTwoStepMethod,
  beginAttendeeTwoStepRecovery,
  countRecentCompletedTwoStepRecoveries,
} from "@/modules/attendee-accounts/two-step-recovery";
import type { RateLimitOutcome } from "@/modules/rate-limit/domain";
import { checkAttendeeTwoStepRecoverySendRateLimit } from "@/modules/rate-limit/service";

export type IssuedTwoStepRecoveryCode = {
  /** The send budget, or the daily cap on completed recoveries, decided no. */
  rateLimited: boolean;
  rateLimit: RateLimitOutcome;
  /**
   * Whether a message was queued. For the server's own use (tests, logs): the route answers the same words
   * whether this is true or not, so the response never says whether the account had anything to recover.
   */
  queued: boolean;
  /** Non-production with no email configured only, as for the sign-in code. Never set in production. */
  developmentCode?: string;
};

/**
 * Sends the recovery code for this session (#221). The send limit is charged first, whatever the account has.
 * Nothing is sent to an account with no method to recover, or to a session that still owes the emailed sign-in
 * code, and the caller cannot tell: the response is the same either way.
 */
export async function issueTwoStepRecoveryCode(input: {
  request: Request;
  accountId: string;
  sessionId: string;
  email: string;
  displayName: string;
}): Promise<IssuedTwoStepRecoveryCode> {
  const rateLimit = await checkAttendeeTwoStepRecoverySendRateLimit(input.request, input.accountId);
  if (!rateLimit.allowed) return { rateLimited: true, rateLimit, queued: false };
  if (await countRecentCompletedTwoStepRecoveries(input.accountId) >= TWO_STEP_RECOVERY_DAILY_LIMIT) {
    return { rateLimited: true, rateLimit, queued: false };
  }
  if (
    !(await accountHasTwoStepMethod(input.accountId))
    || (await accountNeedsSignInStep(input.accountId, input.sessionId)) === "EMAIL_CODE"
  ) {
    return { rateLimited: false, rateLimit, queued: false };
  }

  const pending = await beginAttendeeTwoStepRecovery(input.accountId, input.sessionId);
  const dispatch = await queueAttendeeTwoStepRecoveryCodeEmail({
    accountId: input.accountId,
    stepUpCodeId: pending.id,
    email: input.email,
    displayName: input.displayName,
  });
  if (dispatch.messageId) {
    const messageId = dispatch.messageId;
    after(() => deliverQueuedAttendeeEmail(messageId));
    return { rateLimited: false, rateLimit, queued: true };
  }

  // No account email configured. Production cannot get here (the startup contract requires it); a development
  // deployment gets the code in the response, the way the sign-in code does.
  if (process.env.NODE_ENV === "production") return { rateLimited: false, rateLimit, queued: false };
  const developmentMessageId = `development:two-step-recovery:${pending.id}`;
  await bindAttendeeStepUpMessage(pending.id, developmentMessageId);
  const developmentCode = await mintAttendeeCodeWithoutSending({
    accountId: input.accountId,
    purpose: "two-step-recovery-code",
    messageId: developmentMessageId,
  });
  return { rateLimited: false, rateLimit, queued: Boolean(developmentCode), developmentCode: developmentCode ?? undefined };
}

/**
 * After a recovery completed: tells the account's address, once the response is on its way. Best effort: the
 * recovery already happened and its audit entry exists, so a mail failure is logged (ids only) and never undoes it.
 */
export async function notifyTwoStepRecovered(accountId: string, occurredAt: Date) {
  try {
    const account = await getPrisma().attendeeAccount.findUnique({
      where: { id: accountId },
      select: { email: true, displayName: true },
    });
    if (!account) return;
    const dispatch = await queueAttendeeTwoStepRecoveredEmail({
      accountId,
      email: account.email,
      displayName: account.displayName,
      occurredAt,
    });
    if (dispatch.messageId) {
      const messageId = dispatch.messageId;
      after(() => deliverQueuedAttendeeEmail(messageId));
    }
  } catch (error) {
    logError("The two-step recovery notice could not be queued", error, { accountId });
  }
}
