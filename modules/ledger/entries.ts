import "server-only";

import type { Prisma } from "@prisma/client";
import {
  assertLedgerAmount,
  amendmentDeltaEntry,
  splitSubmissionTotal,
  systemActor,
  type LedgerActor,
  type LedgerEntryDraft,
} from "@/modules/ledger/domain";

/**
 * The only write surface for registration ledger entries (#117): create and append, nothing else. An entry is never
 * updated or deleted (a static test and a database trigger both hold that line); a correction is a new entry. Every
 * function takes the caller's transaction, so an entry commits or rolls back with the total it describes.
 */
type Tx = Pick<Prisma.TransactionClient, "registrationLedgerEntry">;

/** A staff user as an immutable actor snapshot: their id and the name they had at the time. No foreign key. */
export async function staffLedgerActor(tx: Pick<Prisma.TransactionClient, "user">, userId: string): Promise<LedgerActor> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { displayName: true } });
  return { type: "STAFF", id: userId, name: user?.displayName ?? null };
}

const REGISTRATION_FORM_ACTOR = systemActor("Registration form");

/** Append one entry. Throws on a unique-key clash, so a live write can never silently double. */
export async function appendLedgerEntry(tx: Tx, draft: LedgerEntryDraft) {
  assertLedgerAmount(draft.kind, draft.amountCents);
  return tx.registrationLedgerEntry.create({ data: toRow(draft) });
}

/**
 * Append entries, skipping any whose (sourceType, sourceId, kind) already exists. The backfill's write path: it shares
 * the live writers' idempotency key, so a re-run, or a race with a live write, never duplicates.
 */
export async function appendLedgerEntriesIdempotent(tx: Tx, drafts: readonly LedgerEntryDraft[]) {
  for (const draft of drafts) assertLedgerAmount(draft.kind, draft.amountCents);
  if (drafts.length === 0) return 0;
  const result = await tx.registrationLedgerEntry.createMany({
    data: drafts.map(toRow),
    skipDuplicates: true,
  });
  return result.count;
}

function toRow(draft: LedgerEntryDraft): Prisma.RegistrationLedgerEntryUncheckedCreateInput {
  return {
    eventId: draft.eventId,
    registrationId: draft.registrationId,
    kind: draft.kind,
    amountCents: draft.amountCents,
    currency: draft.currency,
    pricingSnapshot: draft.pricingSnapshot as Prisma.InputJsonValue,
    sourceType: draft.sourceType,
    sourceId: draft.sourceId,
    origin: draft.origin,
    actorType: draft.actor.type,
    actorId: draft.actor.id,
    actorNameSnapshot: draft.actor.name,
    reason: draft.reason,
    ...(draft.createdAt ? { createdAt: draft.createdAt } : {}),
  };
}

/**
 * The submission CHARGE of a newly created registration, written in the same transaction as the create. `totalCents`
 * is the integer the caller stores in `Registration.totalAmount` (as cents / 100); a zero total still gets a 0-cent
 * charge so every registration has an entry. When a registration-level promo discount was applied, pass it as
 * `appliedDiscountCents` (positive) and write its DISCOUNT with `recordPromoCodeRedemption`: the charge is then the
 * stored total plus the discount, and the two sum exactly to the stored total.
 */
export async function appendSubmissionCharge(
  tx: Tx,
  input: {
    eventId: string;
    registrationId: string;
    totalCents: number;
    appliedDiscountCents?: number;
    actor?: LedgerActor;
    pricingSnapshot?: Record<string, unknown>;
    currency?: string;
    reason?: string | null;
  },
) {
  const split = splitSubmissionTotal({
    totalCents: input.totalCents,
    appliedDiscountCents: input.appliedDiscountCents ?? 0,
  });
  return appendLedgerEntry(tx, {
    eventId: input.eventId,
    registrationId: input.registrationId,
    kind: "CHARGE",
    amountCents: split.chargeCents,
    currency: input.currency ?? "USD",
    pricingSnapshot: {
      totalCents: Math.max(0, Math.round(input.totalCents)),
      discountAmountCents: -split.discountCents,
      ...input.pricingSnapshot,
    },
    sourceType: "REGISTRATION_SUBMISSION",
    sourceId: input.registrationId,
    origin: "LIVE",
    actor: input.actor ?? REGISTRATION_FORM_ACTOR,
    reason: input.reason ?? null,
  });
}

/** The DISCOUNT for a promo redemption: minus the discount reflected in the stored total. A zero discount writes nothing. */
export async function appendPromoDiscount(
  tx: Tx,
  input: {
    eventId: string;
    registrationId: string;
    redemptionId: string;
    appliedDiscountCents: number;
    pricingSnapshot: Record<string, unknown>;
    actor?: LedgerActor;
  },
) {
  const { discountCents } = splitSubmissionTotal({ totalCents: 0, appliedDiscountCents: input.appliedDiscountCents });
  if (discountCents === 0) return null;
  return appendLedgerEntry(tx, {
    eventId: input.eventId,
    registrationId: input.registrationId,
    kind: "DISCOUNT",
    amountCents: discountCents,
    currency: "USD",
    pricingSnapshot: input.pricingSnapshot,
    sourceType: "PROMO_REDEMPTION",
    sourceId: input.redemptionId,
    origin: "LIVE",
    actor: input.actor ?? REGISTRATION_FORM_ACTOR,
    reason: null,
  });
}

/** An amendment's change in total as a CHARGE or CREDIT keyed to its RegistrationOperation. No change, no entry. */
export async function appendAmendmentDelta(
  tx: Tx,
  input: {
    eventId: string;
    registrationId: string;
    operationId: string;
    previousTotalCents: number;
    finalTotalCents: number;
    actor: LedgerActor;
    pricingSnapshot: Record<string, unknown>;
    reason?: string | null;
  },
) {
  const delta = amendmentDeltaEntry(input.previousTotalCents, input.finalTotalCents);
  if (!delta) return null;
  return appendLedgerEntry(tx, {
    eventId: input.eventId,
    registrationId: input.registrationId,
    kind: delta.kind,
    amountCents: delta.amountCents,
    currency: "USD",
    pricingSnapshot: {
      previousTotalCents: Math.round(input.previousTotalCents),
      totalCents: Math.round(input.finalTotalCents),
      deltaCents: delta.amountCents,
      ...input.pricingSnapshot,
    },
    sourceType: "AMENDMENT",
    sourceId: input.operationId,
    origin: "LIVE",
    actor: input.actor,
    reason: input.reason ?? null,
  });
}
