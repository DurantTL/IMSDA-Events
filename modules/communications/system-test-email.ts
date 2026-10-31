import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { currentCorrelationId } from "@/lib/request-context";
import { getAccountEmailSender } from "@/modules/communications/account-email";

/**
 * The System report's test email (#1383). One plain, clearly labelled message through the real outbox: the same
 * provider, sender and delivery loop as real mail. It has no event, no registration and no account, so nothing is
 * minted into it and no attendee data can reach it. Staff-written free text never appears: the body is fixed here.
 */
export const SYSTEM_TEST_EMAIL_TRIGGER = "SYSTEM_REPORT_TEST";
export const SYSTEM_TEST_EMAIL_SUBJECT = "IMSDA Events test email";

const refAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A short reference such as T-7Q2K, shown in the card and the audit log so a test can be found again. */
export function newSystemTestRef() {
  const bytes = randomBytes(4);
  return `T-${Array.from(bytes, (byte) => refAlphabet[byte % refAlphabet.length]).join("")}`;
}

export function systemTestEmailBody(ref: string) {
  return [
    "This is a test email from the IMSDA Events System report.",
    "",
    "A system administrator sent it to check that email delivery is working. It was sent to this one address only.",
    "It contains no registration or attendee information and nothing is needed from you.",
    "",
    `Test reference: ${ref}`,
    "",
    "IMSDA Events",
  ].join("\n");
}

/** Queues the one test message. Throws `AccountEmailNotConfiguredError` when no account sender is set. */
export async function enqueueSystemTestEmail(input: { to: string; actorUserId: string; ref?: string }) {
  const sender = getAccountEmailSender();
  const ref = input.ref ?? newSystemTestRef();
  const message = await getPrisma().messageOutbox.create({
    data: {
      eventId: null,
      templateKey: "SYSTEM_TEST_EMAIL",
      recipientKind: "TEST",
      recipientEmail: input.to.trim().toLowerCase(),
      senderNameSnapshot: sender.name,
      senderEmailSnapshot: sender.address,
      replyToEmailSnapshot: sender.replyTo,
      subjectSnapshot: SYSTEM_TEST_EMAIL_SUBJECT,
      bodyTextSnapshot: systemTestEmailBody(ref),
      metadata: {
        trigger: SYSTEM_TEST_EMAIL_TRIGGER,
        realDelivery: true,
        testRef: ref,
        testedByUserId: input.actorUserId,
      } satisfies Prisma.InputJsonValue,
      idempotencyKey: `system-test:${randomUUID()}`,
      correlationId: currentCorrelationId() ?? randomUUID(),
      status: "PENDING",
    },
    select: { id: true },
  });
  return { messageId: message.id, ref };
}
