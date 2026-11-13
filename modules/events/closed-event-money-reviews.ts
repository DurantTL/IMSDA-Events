import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { CLOSED_MONEY_CLEAR_NOTE_MAX_LENGTH } from "@/modules/events/closeout-domain";
import { isMoneyLocked, readEventLifecycleForMoney } from "@/modules/events/money-lock";

/**
 * Money recorded while an event was Closed. Square payments and refunds that arrive after the close (a webhook, or a card
 * attempt that finishes late) are never refused: the money already moved, so the payment or refund is recorded as usual
 * and, in the same transaction, one flag row is raised for the finance office. The flag is cleared by a named person with a
 * note, never deleted, and an uncleared flag blocks the closeout sign-off. Ids and cents only; no attendee detail.
 */

export type ClosedMoneyReviewKind = "PAYMENT" | "REFUND";
export type ClosedMoneyReviewSource = "SQUARE_CARD" | "SQUARE_WEBHOOK" | "SQUARE_EXTERNAL" | "SQUARE_REFUND" | "SQUARE_DUPLICATE";

export { CLOSED_MONEY_CLEAR_NOTE_MAX_LENGTH };

/**
 * Raises the flag for one recorded payment or refund when the event is Closed (its stored state, read in this transaction
 * with a key-share lock, so it is ordered against a sign-off). Idempotent: one row per payment and per refund, so a replayed
 * webhook changes nothing and writes no second audit entry. Returns true when a flag was raised now.
 */
export async function raiseClosedMoneyReview(
  tx: Prisma.TransactionClient,
  input: { eventId: string; kind: ClosedMoneyReviewKind; paymentId?: string; refundId?: string; amountCents: number; source: ClosedMoneyReviewSource },
) {
  // A payment review needs a payment id and a refund review a refund id; without one there is nothing to key it on.
  const target = input.kind === "PAYMENT" ? input.paymentId : input.refundId;
  if (!target) return false;
  const event = await readEventLifecycleForMoney(tx, input.eventId);
  if (!event || !isMoneyLocked(event.lifecycleState)) return false;
  const key = input.kind === "PAYMENT" ? { paymentId: target } : { refundId: target };
  // ON CONFLICT DO NOTHING on the unique payment and refund ids: two first deliveries racing each other leave one row and
  // neither rolls back the payment (a unique-violation error would abort this transaction).
  const created = await tx.closedEventMoneyReview.createMany({
    data: [{ eventId: input.eventId, kind: input.kind, ...key, amountCents: Math.abs(Math.trunc(input.amountCents)), source: input.source }],
    skipDuplicates: true,
  });
  if (created.count === 0) return false;
  const row = await tx.closedEventMoneyReview.findFirstOrThrow({ where: { eventId: input.eventId, ...key }, select: { id: true } });
  await writeAuditLog({
    eventId: input.eventId,
    action: "CLOSED_EVENT_MONEY_RAISED",
    entityType: "ClosedEventMoneyReview",
    entityId: row.id,
    summary: `Square ${input.kind === "PAYMENT" ? "payment" : "refund"} recorded after the event was closed; listed for the finance office to review.`,
    metadata: { reviewId: row.id, kind: input.kind, paymentId: input.paymentId ?? null, refundId: input.refundId ?? null, amountCents: input.amountCents, source: input.source },
  }, tx);
  return true;
}

export class ClosedMoneyReviewError extends Error {
  constructor(public readonly code: "REVIEW_NOT_FOUND" | "ALREADY_CLEARED" | "NOTE_REQUIRED" | "NOTE_TOO_LONG" | "ACTOR_NOT_FOUND", message: string) {
    super(message);
    this.name = "ClosedMoneyReviewError";
  }
}

/** Counts and sums the uncleared flags of an event; `client` may be a transaction. */
export async function summarizeUnclearedClosedMoney(eventId: string, client: Prisma.TransactionClient | PrismaClient = getPrisma()) {
  const rows = await client.closedEventMoneyReview.findMany({ where: { eventId, clearedAt: null }, select: { amountCents: true } });
  return { count: rows.length, cents: rows.reduce((total, row) => total + row.amountCents, 0) };
}

export type ClosedMoneyReviewRow = {
  id: string;
  kind: ClosedMoneyReviewKind;
  amountCents: number;
  source: string;
  createdAt: string;
  /** The Square reference stored on the payment or refund, when there is one. */
  reference: string | null;
};

export async function listUnclearedClosedMoney(eventId: string, client: PrismaClient = getPrisma()): Promise<ClosedMoneyReviewRow[]> {
  const rows = await client.closedEventMoneyReview.findMany({
    where: { eventId, clearedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
    include: { payment: { select: { externalReference: true } }, refund: { select: { externalReference: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind === "REFUND" ? "REFUND" : "PAYMENT",
    amountCents: row.amountCents,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    reference: (row.kind === "REFUND" ? row.refund?.externalReference : row.payment?.externalReference) ?? null,
  }));
}

/**
 * A finance admin has looked at the money and marks the flag reviewed. Changes no payment and no refund. Refused when the
 * note is empty or too long, or when the flag is already cleared (so who cleared it is never overwritten). Works in any
 * lifecycle state; the route checks the permission.
 */
export async function clearClosedMoneyReview(
  input: { eventId: string; reviewId: string; actorUserId: string; note: string },
  client: PrismaClient = getPrisma(),
) {
  const note = input.note.trim();
  if (!note) throw new ClosedMoneyReviewError("NOTE_REQUIRED", "Write a short note saying what you checked.");
  if (note.length > CLOSED_MONEY_CLEAR_NOTE_MAX_LENGTH) throw new ClosedMoneyReviewError("NOTE_TOO_LONG", `The note can be at most ${CLOSED_MONEY_CLEAR_NOTE_MAX_LENGTH} characters.`);
  const user = await client.user.findUnique({ where: { id: input.actorUserId }, select: { displayName: true } });
  const name = user?.displayName.trim();
  if (!name) throw new ClosedMoneyReviewError("ACTOR_NOT_FOUND", "Your account could not be found. Sign in again and try once more.");
  return client.$transaction(async (tx) => {
    const flag = await tx.closedEventMoneyReview.findFirst({
      where: { id: input.reviewId, eventId: input.eventId },
      select: { id: true, kind: true, paymentId: true, refundId: true, amountCents: true },
    });
    if (!flag) throw new ClosedMoneyReviewError("REVIEW_NOT_FOUND", "That item was not found for this event.");
    const cleared = await tx.closedEventMoneyReview.updateMany({
      where: { id: flag.id, clearedAt: null },
      data: { clearedAt: new Date(), clearedByUserId: input.actorUserId, clearedByNameSnapshot: name, clearNote: note },
    });
    if (cleared.count === 0) throw new ClosedMoneyReviewError("ALREADY_CLEARED", "That item was already marked reviewed.");
    await writeAuditLog({
      eventId: input.eventId,
      actorUserId: input.actorUserId,
      action: "CLOSED_EVENT_MONEY_CLEARED",
      entityType: "ClosedEventMoneyReview",
      entityId: flag.id,
      summary: "A finance admin marked money recorded after close as reviewed.",
      metadata: { reviewId: flag.id, kind: flag.kind, paymentId: flag.paymentId, refundId: flag.refundId, amountCents: flag.amountCents },
    }, tx);
    return { id: flag.id };
  });
}
