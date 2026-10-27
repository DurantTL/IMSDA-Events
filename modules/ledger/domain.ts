/**
 * Registration ledger, slice 1 (#117, parent #74). Pure rules: no database, no clock.
 *
 * Amounts are integer cents and SIGNED, so what a registration owes is the plain sum of its entries:
 * a CHARGE is zero or more, a DISCOUNT or a CREDIT is zero or less. The database enforces the same sign rule.
 */

export const ledgerEntryKinds = ["CHARGE", "DISCOUNT", "CREDIT"] as const;
export type LedgerEntryKind = (typeof ledgerEntryKinds)[number];

export const ledgerSourceTypes = ["REGISTRATION_SUBMISSION", "AMENDMENT", "PROMO_REDEMPTION"] as const;
export type LedgerSourceType = (typeof ledgerSourceTypes)[number];

export type LedgerOrigin = "LIVE" | "BACKFILL";
export type LedgerActorType = "SYSTEM" | "STAFF" | "ATTENDEE_ACCOUNT" | "PERSON";

export type LedgerActor = {
  type: LedgerActorType;
  id: string | null;
  name: string | null;
};

export const systemActor = (name: string): LedgerActor => ({ type: "SYSTEM", id: null, name });

export type LedgerAmountEntry = { amountCents: number };

/** The one place a registration's total is computed from entries. Nothing user-visible calls it in slice 1. */
export function deriveRegistrationTotalCents(entries: readonly LedgerAmountEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.amountCents, 0);
}

/** Why an entry's amount is not allowed, or null. Mirrors the database check constraint. */
export function ledgerAmountProblem(kind: LedgerEntryKind, amountCents: number): string | null {
  if (!Number.isSafeInteger(amountCents)) return "A ledger amount is a whole number of cents.";
  if (kind === "CHARGE" && amountCents < 0) return "A charge cannot be negative.";
  if ((kind === "DISCOUNT" || kind === "CREDIT") && amountCents > 0) {
    return `A ${kind.toLowerCase()} cannot be positive.`;
  }
  return null;
}

export function assertLedgerAmount(kind: LedgerEntryKind, amountCents: number) {
  const problem = ledgerAmountProblem(kind, amountCents);
  if (problem) throw new Error(problem);
}

/**
 * How a priced registration's stored total splits into entries. The discount is the one actually reflected in the stored
 * total (already capped at the subtotal by the pricing step). The charge is the stored total plus that discount, so the
 * two always sum to exactly what is stored, a waitlisted registration (no processing fee) included. Never negative.
 */
export function splitSubmissionTotal(input: { totalCents: number; appliedDiscountCents: number }) {
  const totalCents = Math.max(0, Math.round(input.totalCents));
  const discountCents = Math.max(0, Math.round(input.appliedDiscountCents));
  return {
    chargeCents: totalCents + discountCents,
    discountCents: 0 - discountCents,
  };
}

/** An amendment's change in total as one entry, or null when the total did not move (nothing is written). */
export function amendmentDeltaEntry(previousTotalCents: number, finalTotalCents: number) {
  const delta = Math.round(finalTotalCents) - Math.round(previousTotalCents);
  if (delta === 0) return null;
  return { kind: (delta > 0 ? "CHARGE" : "CREDIT") as LedgerEntryKind, amountCents: delta };
}

export type LedgerEntryDraft = {
  eventId: string;
  registrationId: string;
  kind: LedgerEntryKind;
  amountCents: number;
  currency: string;
  pricingSnapshot: Record<string, unknown>;
  sourceType: LedgerSourceType;
  sourceId: string;
  origin: LedgerOrigin;
  actor: LedgerActor;
  reason: string | null;
  createdAt?: Date;
};

export const ledgerEntryKey = (entry: { sourceType: string; sourceId: string; kind: string }) =>
  `${entry.sourceType}:${entry.sourceId}:${entry.kind}`;

// ---------------------------------------------------------------------------------------------------------------
// Backfill planning (pure): what entries a registration should have, reconstructed from what is stored today.
// ---------------------------------------------------------------------------------------------------------------

export type BackfillAmendment = {
  id: string;
  createdAt: Date;
  actorUserId: string | null;
  actorAttendeeAccountId: string | null;
  actorPersonId: string | null;
  actorNameSnapshot: string;
  beforeSnapshot: unknown;
  afterSnapshot: unknown;
};

export type BackfillRedemption = {
  id: string;
  createdAt: Date;
  codeSnapshot: string;
  discountTypeSnapshot: string;
  discountValueSnapshot: number;
  minimumSubtotalCentsSnapshot: number | null;
  maximumDiscountCentsSnapshot: number | null;
  eligibleSubtotalCents: number;
  discountAmountCents: number;
  pricingDate: string;
};

export type BackfillRegistration = {
  id: string;
  eventId: string;
  totalCents: number;
  submittedAt: Date | null;
  createdAt: Date;
  redemption: BackfillRedemption | null;
  amendments: readonly BackfillAmendment[];
  existingKeys: ReadonlySet<string>;
  existingSumCents: number;
};

export type BackfillPlan = {
  entries: LedgerEntryDraft[];
  /** Entries already stored plus the planned ones. */
  resultingTotalCents: number;
  /** Current stored total minus the reconstructed total. Not zero when a writer outside this slice changed the total. */
  residualCents: number;
  warnings: string[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The registration total (cents) an amendment snapshot recorded, or null if the snapshot does not hold one. */
export function snapshotTotalCents(snapshot: unknown): number | null {
  const total = record(record(snapshot)?.registration)?.totalAmountCents;
  return typeof total === "number" && Number.isFinite(total) ? Math.round(total) : null;
}

function snapshotPricing(snapshot: unknown) {
  return record(record(snapshot)?.pricingSnapshot);
}

function actorOf(amendment: BackfillAmendment): LedgerActor {
  if (amendment.actorUserId) return { type: "STAFF", id: amendment.actorUserId, name: amendment.actorNameSnapshot };
  if (amendment.actorAttendeeAccountId) {
    return { type: "ATTENDEE_ACCOUNT", id: amendment.actorAttendeeAccountId, name: amendment.actorNameSnapshot };
  }
  if (amendment.actorPersonId) return { type: "PERSON", id: amendment.actorPersonId, name: amendment.actorNameSnapshot };
  return systemActor(amendment.actorNameSnapshot);
}

export const BACKFILL_ACTOR_NAME = "Ledger backfill";

/**
 * Reconstructs the history without flattening it, in time order:
 * 1. the submission CHARGE: the total before the first amendment (else today's total) plus the promo discount that
 *    applied at submission (the first amendment's recorded discount, else the redemption's);
 * 2. the promo DISCOUNT;
 * 3. one CHARGE or CREDIT per amendment whose snapshots show a change in total.
 * Keys that already exist are left alone, so a re-run writes nothing. No balancing "plug" entry is ever invented: a
 * total that moved through a writer outside this slice shows as `residualCents` and is left for the health view.
 */
export function planRegistrationBackfill(registration: BackfillRegistration): BackfillPlan {
  const warnings: string[] = [];
  const amendments = [...registration.amendments].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const drafts: LedgerEntryDraft[] = [];
  const base = { eventId: registration.eventId, registrationId: registration.id, origin: "BACKFILL" as const };
  const systemBackfill = systemActor(BACKFILL_ACTOR_NAME);

  // Amendment deltas, read from the operation snapshots.
  const amendmentDrafts: LedgerEntryDraft[] = [];
  for (const amendment of amendments) {
    const before = snapshotTotalCents(amendment.beforeSnapshot);
    const after = snapshotTotalCents(amendment.afterSnapshot);
    if (before === null || after === null) {
      warnings.push(`Amendment ${amendment.id} has no totals in its snapshots, so it was not reconstructed.`);
      continue;
    }
    const delta = amendmentDeltaEntry(before, after);
    if (!delta) continue;
    amendmentDrafts.push({
      ...base,
      kind: delta.kind,
      amountCents: delta.amountCents,
      currency: "USD",
      pricingSnapshot: {
        reconstructedFrom: "RegistrationOperation snapshots",
        previousTotalCents: before,
        totalCents: after,
        deltaCents: delta.amountCents,
        pricing: snapshotPricing(amendment.afterSnapshot),
      },
      sourceType: "AMENDMENT",
      sourceId: amendment.id,
      actor: actorOf(amendment),
      reason: null,
      createdAt: amendment.createdAt,
    });
  }

  // The total before any amendment: the first amendment's "before" (even one that did not move the total), else today's.
  const firstBefore = amendments.length > 0 ? snapshotTotalCents(amendments[0].beforeSnapshot) : null;
  const preAmendmentTotalCents = firstBefore ?? registration.totalCents;
  const redemption = registration.redemption;
  const firstBeforeDiscount = amendments.length > 0 ? snapshotPricing(amendments[0].beforeSnapshot)?.discountAmountCents : undefined;
  const submissionDiscountCents = redemption
    ? Math.max(
        0,
        typeof firstBeforeDiscount === "number" && Number.isFinite(firstBeforeDiscount)
          ? Math.round(firstBeforeDiscount)
          : redemption.discountAmountCents,
      )
    : 0;
  const split = splitSubmissionTotal({
    totalCents: preAmendmentTotalCents,
    appliedDiscountCents: submissionDiscountCents,
  });
  drafts.push({
    ...base,
    kind: "CHARGE",
    amountCents: split.chargeCents,
    currency: "USD",
    pricingSnapshot: {
      reconstructedFrom: firstBefore === null ? "Registration.totalAmount" : "first amendment snapshot",
      totalCents: preAmendmentTotalCents,
      discountAmountCents: submissionDiscountCents,
    },
    sourceType: "REGISTRATION_SUBMISSION",
    sourceId: registration.id,
    actor: systemBackfill,
    reason: null,
    createdAt: registration.submittedAt ?? registration.createdAt,
  });
  if (redemption && split.discountCents !== 0) {
    drafts.push({
      ...base,
      kind: "DISCOUNT",
      amountCents: split.discountCents,
      currency: "USD",
      pricingSnapshot: {
        reconstructedFrom: "PromoCodeRedemption",
        code: redemption.codeSnapshot,
        discountType: redemption.discountTypeSnapshot,
        discountValue: redemption.discountValueSnapshot,
        minimumSubtotalCents: redemption.minimumSubtotalCentsSnapshot,
        maximumDiscountCents: redemption.maximumDiscountCentsSnapshot,
        eligibleSubtotalCents: redemption.eligibleSubtotalCents,
        discountAmountCents: submissionDiscountCents,
        pricingDate: redemption.pricingDate,
      },
      sourceType: "PROMO_REDEMPTION",
      sourceId: redemption.id,
      actor: systemBackfill,
      reason: null,
      createdAt: redemption.createdAt,
    });
  }
  drafts.push(...amendmentDrafts);

  const entries = drafts.filter((draft) => !registration.existingKeys.has(ledgerEntryKey(draft)));
  const resultingTotalCents = registration.existingSumCents + deriveRegistrationTotalCents(entries);
  return {
    entries,
    resultingTotalCents,
    residualCents: registration.totalCents - resultingTotalCents,
    warnings,
  };
}
