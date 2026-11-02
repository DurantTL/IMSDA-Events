import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { hashOneTimeCode } from "@/modules/attendee-accounts/codes";
import { spacedSignInCode } from "@/modules/attendee-accounts/attendee-email";
import {
  getAccountEmailSender,
  isAccountEmailConfigured,
} from "@/modules/communications/account-email";
import {
  SECURITY_CHECK_CODE_LIFETIME_MINUTES,
  attachSecurityCheckCode,
  bindSecurityCheckCodeMessage,
  normalizeSecurityCheckEmail,
  reuseSecurityCheckCode,
  revokeSecurityCheckCode,
} from "@/modules/security/security-check-code-store";

/**
 * The email that carries a Security check code (#1480). It goes through the account slice of the outbox (`eventId`
 * null, sender from the `ACCOUNT_EMAIL_*` variables) with no account id, because a sign-up has no account and the
 * sender must not learn whether one exists. The code is minted when the message is delivered, so the outbox row keeps
 * only the sentinel and a database read never yields a usable code.
 */

export const SECURITY_CHECK_CODE_TEMPLATE_KEY = "SECURITY_CHECK_CODE" as const;
export const SECURITY_CHECK_CODE_DISPLAY_SENTINEL = "{{security_check_code_display}}";

function securityCheckCodeBody() {
  return {
    // No code in the subject: the provider's webhook stores the subject it was sent. The code is in the body only.
    subject: "Your IMSDA Events security code",
    bodyText: [
      "Enter this code on the IMSDA Events page where you asked for it, in place of the security check:",
      "",
      SECURITY_CHECK_CODE_DISPLAY_SENTINEL,
      "",
      `It works for ${SECURITY_CHECK_CODE_LIFETIME_MINUTES} minutes, once. Don't share this code with anyone. IMSDA staff will never ask for it.`,
      "",
      // Two lines on purpose: the layout shows a short title over more text as a note box.
      "Didn't ask for this?",
      "You can ignore this email. The code does nothing on its own and stops working by itself.",
      "",
      "IMSDA Events",
    ].join("\n"),
  };
}

export function isSecurityCheckEmailConfigured() {
  return isAccountEmailConfigured();
}

/**
 * Queues the code email for a pending code. Returns the message id, or null when this deployment has no account email
 * configured (development) or the pending code was superseded before it could be bound.
 */
export async function queueSecurityCheckCodeEmail(input: { codeId: string; email: string }) {
  if (!isSecurityCheckEmailConfigured()) return { configured: false as const, messageId: null };
  const sender = getAccountEmailSender();
  const content = securityCheckCodeBody();
  const message = await getPrisma().messageOutbox.create({
    data: {
      eventId: null,
      templateKey: SECURITY_CHECK_CODE_TEMPLATE_KEY,
      recipientKind: "ACCOUNT",
      recipientEmail: normalizeSecurityCheckEmail(input.email),
      senderNameSnapshot: sender.name,
      senderEmailSnapshot: sender.address,
      replyToEmailSnapshot: sender.replyTo,
      subjectSnapshot: content.subject,
      bodyTextSnapshot: content.bodyText,
      metadata: {
        trigger: "SECURITY_CHECK_CODE_REQUESTED",
        accountEmail: true,
        realDelivery: true,
      } satisfies Prisma.InputJsonValue,
      idempotencyKey: `security-check:${SECURITY_CHECK_CODE_TEMPLATE_KEY}:${randomUUID()}`,
      correlationId: randomUUID(),
      status: "PENDING",
    },
    select: { id: true },
  });
  if (!await bindSecurityCheckCodeMessage(input.codeId, message.id)) {
    throw new Error("The security check code message could not be bound to its code.");
  }
  return { configured: true as const, messageId: message.id };
}

/** Called by the delivery worker: puts the code into the message being sent. The stored row keeps the sentinel. */
export async function prepareSecurityCheckCodeForDelivery(input: {
  messageId: string;
  bodyText: string;
  now: Date;
}): Promise<{ bodyText: string; codeBox: { code: string; caption: string }; revokeOnDefinitiveFailure?: () => Promise<void> }> {
  const reused = await reuseSecurityCheckCode({ messageId: input.messageId, now: input.now });
  const code = reused ?? await attachSecurityCheckCode({ messageId: input.messageId, now: input.now });
  if (!code) {
    // Superseded by a newer code, spent, or expired while queued: sending a code nothing will accept helps nobody.
    throw new Error("There is no live security check code to send.");
  }
  const displayCode = spacedSignInCode(code);
  return {
    bodyText: input.bodyText.replaceAll(SECURITY_CHECK_CODE_DISPLAY_SENTINEL, displayCode),
    codeBox: { code: displayCode, caption: `Works for ${SECURITY_CHECK_CODE_LIFETIME_MINUTES} minutes` },
    ...(reused
      ? {}
      : { revokeOnDefinitiveFailure: async () => { await revokeSecurityCheckCode(hashOneTimeCode(code), input.now); } }),
  };
}
