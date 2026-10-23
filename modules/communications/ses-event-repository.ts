import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import type { SesFeedback } from "@/integrations/email/ses-sns";
import { getPrisma } from "@/lib/prisma";
import { retireClubFormLinkForMessage } from "@/modules/club-forms/link-email";
import { suppressAddress } from "@/modules/communications/email-suppression";
import {
  mapSesDeliveryEvent,
  providerAdvanceCondition,
  providerTransitionUpdate,
} from "@/modules/communications/provider-events";

export type SesEventRecordResult = {
  duplicate: boolean;
  matchedMessageId: string | null;
  mappedStatus: string | null;
  /** How many addresses this event newly suppressed (a count, never the addresses). */
  suppressedCount: number;
};

type Client = Pick<PrismaClient, "$transaction" | "messageProviderEvent">;

/**
 * Records one SES notification delivered by SNS (#863), replay-safe and keyed by the SNS `MessageId`.
 *
 * - A `MessageId` already stored is a duplicate: nothing changes, so SNS can redeliver as often as it likes. A concurrent
 *   duplicate loses the unique-index race and is treated the same way.
 * - The message is found only by `provider: "SES"` and the exact provider message id the adapter recorded. An id that
 *   matches nothing is held with no message (so it can be linked when the send is recorded) and attaches to nothing.
 * - A delivery moves ACCEPTED/SENT to DELIVERED; a permanent bounce or a complaint is terminal. The write is conditional
 *   on the current status (`providerAdvanceCondition`), so a duplicate, a late delivery report or a second terminal
 *   event can never roll a terminal state backward. Soft bounces are stored and change nothing.
 * - A hard bounce or complaint suppresses each reported address (all email to it stops until an administrator
 *   re-enables it). This does not depend on the message matching: the address bounced at SES whoever sent to it.
 * - The stored payload holds ids and counts only. The address is kept in normalized form only on the suppression row.
 *
 * Everything runs in one transaction: a storage failure stores nothing and is thrown, so the route answers 5xx and SNS
 * retries the whole notification.
 */
export async function recordSesFeedbackEvent(
  snsMessageId: string,
  feedback: SesFeedback,
  client: Client = getPrisma(),
): Promise<SesEventRecordResult> {
  const transition = mapSesDeliveryEvent(feedback.eventType, feedback.occurredAt);
  const findStored = (db: Pick<PrismaClient, "messageProviderEvent">) => db.messageProviderEvent.findUnique({
    where: { provider_providerEventId: { provider: "SES", providerEventId: snsMessageId } },
    select: { messageOutboxId: true, mappedDeliveryStatus: true },
  });
  try {
    return await client.$transaction(async (tx) => {
      const existing = await findStored(tx);
      if (existing) {
        return { duplicate: true, matchedMessageId: existing.messageOutboxId, mappedStatus: existing.mappedDeliveryStatus, suppressedCount: 0 };
      }
      const message = await tx.messageOutbox.findFirst({
        where: { provider: "SES", providerMessageId: feedback.providerMessageId },
        select: { id: true },
      });
      await tx.messageProviderEvent.create({
        data: {
          messageOutboxId: message?.id ?? null,
          provider: "SES",
          providerEventId: snsMessageId,
          providerMessageId: feedback.providerMessageId,
          eventType: feedback.eventType,
          mappedDeliveryStatus: transition?.status ?? null,
          occurredAt: feedback.occurredAt,
          // Ids and counts only. No address, no subject, no headers.
          payload: {
            eventType: feedback.eventType,
            messageId: feedback.providerMessageId,
            ...feedback.details,
          } as Prisma.InputJsonValue,
        },
      });
      if (message && transition) {
        const applied = await tx.messageOutbox.updateMany({
          where: { id: message.id, ...providerAdvanceCondition(transition.status) },
          data: providerTransitionUpdate(transition),
        });
        // A hard bounce means a club form link never reached its person (#610): withdraw it, but only when this event
        // really applied. A complaint arrives after delivery and must not kill the parent's link.
        if (applied.count > 0 && transition.status === "BOUNCED") {
          await retireClubFormLinkForMessage(tx, message.id, feedback.occurredAt);
        }
      }
      let suppressedCount = 0;
      const reason = feedback.kind === "HARD_BOUNCE" ? "BOUNCE" : feedback.kind === "COMPLAINT" ? "COMPLAINT" : null;
      if (reason) {
        for (const normalizedEmail of feedback.suppressRecipients) {
          const result = await suppressAddress(tx, {
            normalizedEmail,
            reason,
            provider: "SES",
            occurredAt: feedback.occurredAt,
            sourceProviderEventId: snsMessageId,
            sourceMessageOutboxId: message?.id ?? null,
          });
          if (result.changed) suppressedCount += 1;
        }
      }
      return { duplicate: false, matchedMessageId: message?.id ?? null, mappedStatus: transition?.status ?? null, suppressedCount };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await findStored(client);
      if (existing) {
        return { duplicate: true, matchedMessageId: existing.messageOutboxId, mappedStatus: existing.mappedDeliveryStatus, suppressedCount: 0 };
      }
    }
    throw error;
  }
}
