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

/** An actor as an immutable snapshot. Only a staff member's name is kept; no other person's name is stored (#117 M1). */
export function ledgerActor(type: LedgerActorType, id: string | null, name: string | null): LedgerActor {
  return { type, id, name: type === "STAFF" || type === "SYSTEM" ? name : null };
}

const moneyKeys = [
  "pricingDate", "formVersionId", "preDiscountSubtotalCents", "discountAmountCents", "promoCode", "subtotalCents",
  "processingFeeCents", "totalCents", "cardSelected", "depositSelected", "registrationStatus",
] as const;

/**
 * The money-only pricing facts that may be kept in an immutable entry: totals, the promo code text and the line items
 * (key, label, amount, pricing label, attendee position). Names, attendee labels, contact details and every other field of
 * a stored pricing snapshot are dropped, because a ledger row can never be edited or erased afterwards (#117 M1).
 */
export function moneyOnlyPricingSnapshot(value: unknown): Record<string, unknown> {
  const source = record(value);
  if (!source) return {};
  const result: Record<string, unknown> = {};
  for (const key of moneyKeys) {
    const item = source[key];
    if (typeof item === "number" && Number.isFinite(item)) result[key] = item;
    else if (typeof item === "string" || typeof item === "boolean" || item === null) result[key] = item;
  }
  if (typeof source.currency === "string") result.currency = source.currency;
  if (Array.isArray(source.lineItems)) {
    result.lineItems = source.lineItems.flatMap((line) => {
      const item = record(line);
      if (!item || typeof item.key !== "string" || typeof item.amountCents !== "number") return [];
      return [{
        key: item.key,
        label: typeof item.label === "string" ? item.label : "",
        amountCents: item.amountCents,
        ...(typeof item.pricingLabel === "string" ? { pricingLabel: item.pricingLabel } : {}),
        ...(typeof item.attendeeIndex === "number" ? { attendeeIndex: item.attendeeIndex } : {}),
      }];
    });
  }
  return result;
}

const personalKey = /name|email|phone|contact|birth|attendeelabel/i;

/** Backstop at the write: removes any key that looks like a name or contact field, at any depth. */
export function stripPersonalKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPersonalKeys);
  const item = record(value);
  if (!item) return value;
  return Object.fromEntries(
    Object.entries(item).filter(([key]) => !personalKey.test(key)).map(([key, inner]) => [key, stripPersonalKeys(inner)]),
  );
}

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
  /** The original public submission's pricing snapshot (never rewritten by amendments), when there is one. */
  submissionSnapshot?: unknown;
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
  /** Set when the history cannot be rebuilt safely: nothing is planned and the registration is reported as failed. */
  failure: string | null;
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
  if (amendment.actorUserId) return ledgerActor("STAFF", amendment.actorUserId, amendment.actorNameSnapshot);
  if (amendment.actorAttendeeAccountId) return ledgerActor("ATTENDEE_ACCOUNT", amendment.actorAttendeeAccountId, null);
  if (amendment.actorPersonId) return ledgerActor("PERSON", amendment.actorPersonId, null);
  return systemActor(amendment.actorNameSnapshot);
}

export const BACKFILL_ACTOR_NAME = "Ledger backfill";

function snapshotCurrency(...snapshots: unknown[]) {
  for (const snapshot of snapshots) {
    const currency = record(snapshot)?.currency;
    if (typeof currency === "string" && currency) return currency;
  }
  return "USD";
}

function numberField(source: Record<string, unknown> | null, key: string) {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

/**
 * Reconstructs the history without flattening it, in time order:
 * 1. the submission CHARGE and, for a promo registration, its DISCOUNT: from the original public submission's pricing
 *    snapshot when there is one (so a total moved later by something the ledger does not record yet stays a residual,
 *    the same for old and new registrations); otherwise from the total before the first amendment, else today's total;
 * 2. one CHARGE or CREDIT per amendment whose snapshots show a change in total.
 * It fails closed: an amendment without totals in its snapshots fails the registration and plans nothing; a registration
 * whose entries already sum to its total plans nothing; and the promo discount is only planned together with the
 * submission charge. No balancing "plug" entry is ever invented: what is left over is `residualCents`.
 */
export function planRegistrationBackfill(registration: BackfillRegistration): BackfillPlan {
  const warnings: string[] = [];
  const empty = (failure: string | null): BackfillPlan => ({
    entries: [],
    resultingTotalCents: registration.existingSumCents,
    residualCents: registration.totalCents - registration.existingSumCents,
    warnings,
    failure,
  });
  // Already whole: entries exist and equal the stored total.
  if (registration.existingKeys.size > 0 && registration.existingSumCents === registration.totalCents) return empty(null);

  const amendments = [...registration.amendments].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const base = { eventId: registration.eventId, registrationId: registration.id, origin: "BACKFILL" as const };
  const systemBackfill = systemActor(BACKFILL_ACTOR_NAME);
  const submissionKey = ledgerEntryKey({ sourceType: "REGISTRATION_SUBMISSION", sourceId: registration.id, kind: "CHARGE" });
  const submissionExists = registration.existingKeys.has(submissionKey);

  // Amendment deltas, read from the operation snapshots. Any amendment still to be rebuilt needs both totals.
  const amendmentDrafts: LedgerEntryDraft[] = [];
  for (const amendment of amendments) {
    const before = snapshotTotalCents(amendment.beforeSnapshot);
    const after = snapshotTotalCents(amendment.afterSnapshot);
    const key = ledgerEntryKey({ sourceType: "AMENDMENT", sourceId: amendment.id, kind: "CHARGE" });
    const creditKey = ledgerEntryKey({ sourceType: "AMENDMENT", sourceId: amendment.id, kind: "CREDIT" });
    const alreadyThere = registration.existingKeys.has(key) || registration.existingKeys.has(creditKey);
    if (before === null || after === null) {
      if (alreadyThere) continue;
      return empty(`Amendment ${amendment.id} has no before and after totals in its snapshots, so the history cannot be rebuilt.`);
    }
    const delta = amendmentDeltaEntry(before, after);
    if (!delta) continue;
    const afterPricing = snapshotPricing(amendment.afterSnapshot);
    amendmentDrafts.push({
      ...base,
      kind: delta.kind,
      amountCents: delta.amountCents,
      currency: snapshotCurrency(afterPricing),
      pricingSnapshot: {
        reconstructedFrom: "RegistrationOperation snapshots",
        previousTotalCents: before,
        totalCents: after,
        deltaCents: delta.amountCents,
        pricing: moneyOnlyPricingSnapshot(afterPricing),
      },
      sourceType: "AMENDMENT",
      sourceId: amendment.id,
      actor: actorOf(amendment),
      reason: null,
      createdAt: amendment.createdAt,
    });
  }

  const drafts: LedgerEntryDraft[] = [];
  if (!submissionExists) {
    const original = record(registration.submissionSnapshot);
    const originalTotal = numberField(original, "totalCents");
    const firstBefore = amendments.length > 0 ? snapshotTotalCents(amendments[0].beforeSnapshot) : null;
    const redemption = registration.redemption;
    const firstBeforeDiscount = numberField(snapshotPricing(amendments[0]?.beforeSnapshot), "discountAmountCents");
    let openingTotalCents: number;
    let discountCents: number;
    let source: string;
    if (originalTotal !== null) {
      openingTotalCents = originalTotal;
      discountCents = redemption ? numberField(original, "discountAmountCents") ?? redemption.discountAmountCents : 0;
      source = "original submission snapshot";
    } else {
      openingTotalCents = firstBefore ?? registration.totalCents;
      discountCents = redemption ? firstBeforeDiscount ?? redemption.discountAmountCents : 0;
      source = firstBefore === null ? "Registration.totalAmount" : "first amendment snapshot";
    }
    const split = splitSubmissionTotal({ totalCents: openingTotalCents, appliedDiscountCents: discountCents });
    drafts.push({
      ...base,
      kind: "CHARGE",
      amountCents: split.chargeCents,
      currency: snapshotCurrency(original),
      pricingSnapshot: {
        reconstructedFrom: source,
        totalCents: openingTotalCents,
        discountAmountCents: -split.discountCents,
        ...(original ? moneyOnlyPricingSnapshot(original) : {}),
      },
      sourceType: "REGISTRATION_SUBMISSION",
      sourceId: registration.id,
      actor: systemBackfill,
      reason: null,
      createdAt: registration.submittedAt ?? registration.createdAt,
    });
    // The discount belongs with the submission charge: never planned on its own.
    if (redemption && split.discountCents !== 0) {
      drafts.push({
        ...base,
        kind: "DISCOUNT",
        amountCents: split.discountCents,
        currency: snapshotCurrency(original),
        pricingSnapshot: {
          reconstructedFrom: "PromoCodeRedemption",
          code: redemption.codeSnapshot,
          discountType: redemption.discountTypeSnapshot,
          discountValue: redemption.discountValueSnapshot,
          minimumSubtotalCents: redemption.minimumSubtotalCentsSnapshot,
          maximumDiscountCents: redemption.maximumDiscountCentsSnapshot,
          eligibleSubtotalCents: redemption.eligibleSubtotalCents,
          discountAmountCents: -split.discountCents,
          pricingDate: redemption.pricingDate,
        },
        sourceType: "PROMO_REDEMPTION",
        sourceId: redemption.id,
        actor: systemBackfill,
        reason: null,
        createdAt: redemption.createdAt,
      });
    }
  }
  drafts.push(...amendmentDrafts);

  const entries = drafts.filter((draft) => !registration.existingKeys.has(ledgerEntryKey(draft)));
  const resultingTotalCents = registration.existingSumCents + deriveRegistrationTotalCents(entries);
  return {
    entries,
    resultingTotalCents,
    residualCents: registration.totalCents - resultingTotalCents,
    warnings,
    failure: null,
  };
}
