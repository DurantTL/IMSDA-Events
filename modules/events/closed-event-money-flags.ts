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

export type ClosedMoneyFlagKind = "PAYMENT" | "REFUND";
export type ClosedMoneyFlagSource = "SQUARE_CARD" | "SQUARE_WEBHOOK" | "SQUARE_EXTERNAL" | "SQUARE_REFUND" | "SQUARE_DUPLICATE";

export { CLOSED_MONEY_CLEAR_NOTE_MAX_LENGTH };

/**
 * Raises the flag for one recorded payment or refund when the event is Closed (its stored state, read in this transaction
 * with a shared lock, so it is ordered against a sign-off). Idempotent: one row per payment and per refund, so a replayed
 * webhook changes nothing and writes no second audit entry. Returns true when a flag was raised now.
 */
export async function flagIfEventClosed(
  tx: Prisma.TransactionClient,
  input: { eventId: string; kind: ClosedMoneyFlagKind; paymentId?: string; refundId?: string; amountCents: number; source: ClosedMoneyFlagSource },
) {
  const event = await readEventLifecycleForMoney(tx, input.eventId);
  if (!event || !isMoneyLocked(event.lifecycleState)) return false;
  const target = input.kind === "PAYMENT" ? { paymentId: input.paymentId ?? null } : { refundId: input.refundId ?? null };
  const existing = await tx.closedEventMoneyFlag.findFirst({ where: { eventId: input.eventId, ...target }, select: { id: true } });
  if (existing) return false;
  const flag = await tx.closedEventMoneyFlag.create({
    data: {
      eventId: input.eventId,
      kind: input.kind,
      paymentId: input.paymentId ?? null,
      refundId: input.refundId ?? null,
      amountCents: Math.abs(Math.trunc(input.amountCents)),
      source: input.source,
    },
    select: { id: true },
  });
  await writeAuditLog({
    eventId: input.eventId,
    action: "CLOSED_EVENT_MONEY_FLAGGED",
    entityType: "ClosedEventMoneyFlag",
    entityId: flag.id,
    summary: `Square ${input.kind === "PAYMENT" ? "payment" : "refund"} recorded after the event was closed; flagged for the finance office.`,
    metadata: { flagId: flag.id, kind: input.kind, paymentId: input.paymentId ?? null, refundId: input.refundId ?? null, amountCents: input.amountCents, source: input.source },
  }, tx);
  return true;
}

export class ClosedMoneyFlagError extends Error {
  constructor(public readonly code: "FLAG_NOT_FOUND" | "ALREADY_CLEARED" | "NOTE_REQUIRED" | "NOTE_TOO_LONG" | "ACTOR_NOT_FOUND", message: string) {
    super(message);
    this.name = "ClosedMoneyFlagError";
  }
}

/** Counts and sums the uncleared flags of an event; `client` may be a transaction. */
export async function summarizeUnclearedClosedMoney(eventId: string, client: Prisma.TransactionClient | PrismaClient = getPrisma()) {
  const rows = await client.closedEventMoneyFlag.findMany({ where: { eventId, clearedAt: null }, select: { amountCents: true } });
  return { count: rows.length, cents: rows.reduce((total, row) => total + row.amountCents, 0) };
}

export type ClosedMoneyFlagRow = {
  id: string;
  kind: ClosedMoneyFlagKind;
  amountCents: number;
  source: string;
  createdAt: string;
  /** The Square reference stored on the payment or refund, when there is one. */
  reference: string | null;
};

export async function listUnclearedClosedMoney(eventId: string, client: PrismaClient = getPrisma()): Promise<ClosedMoneyFlagRow[]> {
  const rows = await client.closedEventMoneyFlag.findMany({
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
export async function clearClosedMoneyFlag(
  input: { eventId: string; flagId: string; actorUserId: string; note: string },
  client: PrismaClient = getPrisma(),
) {
  const note = input.note.trim();
  if (!note) throw new ClosedMoneyFlagError("NOTE_REQUIRED", "Write a short note saying what you checked.");
  if (note.length > CLOSED_MONEY_CLEAR_NOTE_MAX_LENGTH) throw new ClosedMoneyFlagError("NOTE_TOO_LONG", `The note can be at most ${CLOSED_MONEY_CLEAR_NOTE_MAX_LENGTH} characters.`);
  const user = await client.user.findUnique({ where: { id: input.actorUserId }, select: { displayName: true } });
  const name = user?.displayName.trim();
  if (!name) throw new ClosedMoneyFlagError("ACTOR_NOT_FOUND", "Your account could not be found. Sign in again and try once more.");
  return client.$transaction(async (tx) => {
    const flag = await tx.closedEventMoneyFlag.findFirst({
      where: { id: input.flagId, eventId: input.eventId },
      select: { id: true, kind: true, paymentId: true, refundId: true, amountCents: true },
    });
    if (!flag) throw new ClosedMoneyFlagError("FLAG_NOT_FOUND", "That flag was not found for this event.");
    const cleared = await tx.closedEventMoneyFlag.updateMany({
      where: { id: flag.id, clearedAt: null },
      data: { clearedAt: new Date(), clearedByUserId: input.actorUserId, clearedByNameSnapshot: name, clearNote: note },
    });
    if (cleared.count === 0) throw new ClosedMoneyFlagError("ALREADY_CLEARED", "That flag was already marked reviewed.");
    await writeAuditLog({
      eventId: input.eventId,
      actorUserId: input.actorUserId,
      action: "CLOSED_EVENT_MONEY_CLEARED",
      entityType: "ClosedEventMoneyFlag",
      entityId: flag.id,
      summary: "A finance admin marked money recorded after close as reviewed.",
      metadata: { flagId: flag.id, kind: flag.kind, paymentId: flag.paymentId, refundId: flag.refundId, amountCents: flag.amountCents },
    }, tx);
    return { id: flag.id };
  });
}
