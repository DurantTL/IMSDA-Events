import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getAccountEmailSender } from "@/modules/communications/account-email";

/**
 * Queues one invite email in the outbox, inside the caller's transaction. Every conference invite that is accepted
 * from the account page (club roles, Area Coordinator) goes through here, so the sender, the account-email flags and
 * the idempotency key are written in one place. Like the instructor invites, these use the CLUB_INVITE template key:
 * `trigger` in the metadata is what tells them apart.
 */
export async function queueAccountInviteMessage(
  tx: Prisma.TransactionClient,
  input: {
    recipient: { email: string; name: string };
    content: { subject: string; bodyText: string };
    /** Metadata `trigger`, for example "CLUB_INVITE_SENT". */
    trigger: string;
    /** Extra metadata that points at the invite row, for example `{ clubInviteId }`. */
    reference: Record<string, string>;
    idempotencyPrefix: string;
    entityId: string;
    correlationId?: string;
  },
) {
  const sender = getAccountEmailSender();
  const message = await tx.messageOutbox.create({
    data: {
      eventId: null,
      templateKey: "CLUB_INVITE",
      recipientKind: "ACCOUNT",
      recipientEmail: input.recipient.email,
      recipientName: input.recipient.name || null,
      senderNameSnapshot: sender.name,
      senderEmailSnapshot: sender.address,
      replyToEmailSnapshot: sender.replyTo,
      subjectSnapshot: input.content.subject,
      bodyTextSnapshot: input.content.bodyText,
      metadata: { trigger: input.trigger, accountEmail: true, realDelivery: true, ...input.reference },
      idempotencyKey: `${input.idempotencyPrefix}:${input.entityId}:${randomUUID()}`,
      correlationId: input.correlationId ?? randomUUID(),
      status: "PENDING",
    },
    select: { id: true },
  });
  return message.id;
}
