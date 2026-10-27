import { describe, expect, it } from "vitest";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import {
  amendmentDeltaEntry,
  assertLedgerAmount,
  deriveRegistrationTotalCents,
  ledgerAmountProblem,
  ledgerEntryKey,
  planRegistrationBackfill,
  snapshotTotalCents,
  splitSubmissionTotal,
  type BackfillAmendment,
  type BackfillRegistration,
  moneyOnlyPricingSnapshot,
  stripPersonalKeys,
} from "@/modules/ledger/domain";
import { applyPromoCodeToCalculation, evaluatePromoCode, type PromoCodeRule } from "@/modules/promo-codes/domain";

describe("deriveRegistrationTotalCents", () => {
  it("is a plain sum of signed amounts, and zero with no entries", () => {
    expect(deriveRegistrationTotalCents([])).toBe(0);
    expect(deriveRegistrationTotalCents([{ amountCents: 20_000 }, { amountCents: -2_500 }, { amountCents: 6_000 }, { amountCents: -5_000 }])).toBe(18_500);
  });
});

describe("sign rules", () => {
  it("allows a charge of zero or more, a discount or credit of zero or less, and whole cents only", () => {
    expect(ledgerAmountProblem("CHARGE", 0)).toBeNull();
    expect(ledgerAmountProblem("CHARGE", 1)).toBeNull();
    expect(ledgerAmountProblem("DISCOUNT", 0)).toBeNull();
    expect(ledgerAmountProblem("DISCOUNT", -1)).toBeNull();
    expect(ledgerAmountProblem("CREDIT", -500)).toBeNull();
    expect(ledgerAmountProblem("CHARGE", -1)).toMatch(/charge/);
    expect(ledgerAmountProblem("DISCOUNT", 1)).toMatch(/discount/);
    expect(ledgerAmountProblem("CREDIT", 1)).toMatch(/credit/);
    expect(ledgerAmountProblem("CHARGE", 10.5)).toMatch(/whole number/);
    expect(() => assertLedgerAmount("CREDIT", 5)).toThrow();
    expect(() => assertLedgerAmount("CREDIT", -5)).not.toThrow();
  });

  it("keys an entry by source and kind, the idempotency key live writes and the backfill share", () => {
    expect(ledgerEntryKey({ sourceType: "AMENDMENT", sourceId: "op_1", kind: "CREDIT" })).toBe("AMENDMENT:op_1:CREDIT");
  });
});

describe("submission split", () => {
  const rule = (overrides: Partial<PromoCodeRule> = {}): PromoCodeRule => ({
    id: "promo_1", code: "SAVE25", normalizedCode: "SAVE25", isActive: true, discountType: "FIXED_CENTS", discountValue: 2_500,
    startsOn: null, endsOn: null, minimumSubtotalCents: null, maximumUses: null, maximumDiscountCents: null, redeemedCount: 0, ...overrides,
  });
  const definition = registrationFormDefinitionSchema.parse({
    title: "Split", description: "", confirmationMessage: "Saved.",
    payment: { enabled: true, currency: "USD", paymentMethodFieldKey: "payment_method", cardOptionValue: "Card", percentageBasisPoints: 290, fixedFeeCents: 30, passFeeToRegistrant: true },
    sections: [{ id: "payment", title: "Payment", description: "", fields: [{ id: "payment_method", key: "payment_method", label: "Payment", helpText: "", type: "RADIO", scope: "REGISTRATION", required: true, options: ["Card", "Check"] }] }],
  });
  const calculation = { lineItems: [{ key: "fee", label: "Fee", amountCents: 10_000 }], subtotalCents: 10_000, processingFeeCents: 329, totalCents: 10_329 };
  const priced = (code: Partial<PromoCodeRule>, payment = "Card") => {
    const evaluation = evaluatePromoCode(rule(code), { submittedCode: "SAVE25", eligibleSubtotalCents: 10_000, pricingDate: "2026-08-01" });
    if (!evaluation.valid) throw new Error("fixture");
    return applyPromoCodeToCalculation(definition, { payment_method: payment }, calculation, evaluation);
  };

  it("splits a promo registration into a charge and a discount that sum exactly to the stored total", () => {
    const discounted = priced({});
    const split = splitSubmissionTotal({ totalCents: discounted.totalCents, appliedDiscountCents: discounted.discountAmountCents });
    expect(discounted.discountAmountCents).toBe(2_500);
    expect(split.discountCents).toBe(-2_500);
    expect(split.chargeCents).toBe(discounted.totalCents + 2_500);
    expect(deriveRegistrationTotalCents([{ amountCents: split.chargeCents }, { amountCents: split.discountCents }])).toBe(discounted.totalCents);
  });

  it("uses the discount that was actually applied: a cap lowers it, and a code worth more than the subtotal is held at the subtotal", () => {
    const capped = priced({ discountType: "PERCENT_BPS", discountValue: 5_000, maximumDiscountCents: 1_000 }, "Check");
    expect(capped.discountAmountCents).toBe(1_000);
    const cappedSplit = splitSubmissionTotal({ totalCents: capped.totalCents, appliedDiscountCents: capped.discountAmountCents });
    expect(cappedSplit).toEqual({ chargeCents: 10_000, discountCents: -1_000 });
    expect(cappedSplit.chargeCents + cappedSplit.discountCents).toBe(capped.totalCents);

    const free = priced({ discountValue: 50_000 }, "Check");
    expect(free.discountAmountCents).toBe(10_000);
    expect(free.totalCents).toBe(0);
    const freeSplit = splitSubmissionTotal({ totalCents: free.totalCents, appliedDiscountCents: free.discountAmountCents });
    expect(freeSplit).toEqual({ chargeCents: 10_000, discountCents: -10_000 });
  });

  it("still sums exactly for a waitlisted registration, which carries no processing fee", () => {
    const discounted = priced({});
    const admitted = { ...discounted, processingFeeCents: 0, totalCents: discounted.subtotalCents };
    const split = splitSubmissionTotal({ totalCents: admitted.totalCents, appliedDiscountCents: admitted.discountAmountCents });
    expect(admitted.totalCents).toBe(7_500);
    expect(split).toEqual({ chargeCents: 10_000, discountCents: -2_500 });
    expect(split.chargeCents + split.discountCents).toBe(admitted.totalCents);
  });

  it("writes a zero-total registration as a 0-cent charge and never a negative one", () => {
    expect(splitSubmissionTotal({ totalCents: 0, appliedDiscountCents: 0 })).toEqual({ chargeCents: 0, discountCents: 0 });
    expect(splitSubmissionTotal({ totalCents: -5, appliedDiscountCents: 0 }).chargeCents).toBe(0);
  });
});

describe("amendment delta", () => {
  it("is a charge when the total goes up, a credit when it goes down, and nothing when it does not move", () => {
    expect(amendmentDeltaEntry(10_000, 16_000)).toEqual({ kind: "CHARGE", amountCents: 6_000 });
    expect(amendmentDeltaEntry(16_000, 11_000)).toEqual({ kind: "CREDIT", amountCents: -5_000 });
    expect(amendmentDeltaEntry(11_000, 11_000)).toBeNull();
  });
});

describe("backfill planning", () => {
  const snap = (total: number, discount = 0) => ({ registration: { totalAmountCents: total }, pricingSnapshot: { discountAmountCents: discount } });
  const amendment = (id: string, at: string, before: number, after: number, discount = 0): BackfillAmendment => ({
    id, createdAt: new Date(at), actorUserId: "user_1", actorAttendeeAccountId: null, actorPersonId: null, actorNameSnapshot: "Staff Sample",
    beforeSnapshot: snap(before, discount), afterSnapshot: snap(after, discount),
  });
  const registration = (overrides: Partial<BackfillRegistration> = {}): BackfillRegistration => ({
    id: "reg_1", eventId: "event_1", totalCents: 17_500, submittedAt: new Date("2027-01-10T10:00:00Z"), createdAt: new Date("2027-01-10T10:00:01Z"),
    redemption: null, amendments: [], existingKeys: new Set(), existingSumCents: 0, ...overrides,
  });
  const redemption = {
    id: "red_1", createdAt: new Date("2027-01-10T10:00:00Z"), codeSnapshot: "SAVE25", discountTypeSnapshot: "FIXED_CENTS", discountValueSnapshot: 2_500,
    minimumSubtotalCentsSnapshot: null, maximumDiscountCentsSnapshot: null, eligibleSubtotalCents: 20_000, discountAmountCents: 2_500, pricingDate: "2027-01-10",
  };

  it("reads totals out of an amendment snapshot", () => {
    expect(snapshotTotalCents(snap(12_345))).toBe(12_345);
    expect(snapshotTotalCents({})).toBeNull();
    expect(snapshotTotalCents(null)).toBeNull();
  });

  it("gives a plain registration one charge of today's total", () => {
    const plan = planRegistrationBackfill(registration());
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]).toMatchObject({ kind: "CHARGE", amountCents: 17_500, sourceType: "REGISTRATION_SUBMISSION", sourceId: "reg_1", origin: "BACKFILL" });
    expect(plan.residualCents).toBe(0);
  });

  it("writes a 0-cent charge for a zero-total registration, whatever its status", () => {
    const plan = planRegistrationBackfill(registration({ totalCents: 0 }));
    expect(plan.entries).toEqual([expect.objectContaining({ kind: "CHARGE", amountCents: 0 })]);
    expect(plan.residualCents).toBe(0);
  });

  it("splits a promo registration into the total before the code and the discount", () => {
    const plan = planRegistrationBackfill(registration({ redemption }));
    expect(plan.entries.map((entry) => [entry.kind, entry.amountCents, entry.sourceType, entry.sourceId])).toEqual([
      ["CHARGE", 20_000, "REGISTRATION_SUBMISSION", "reg_1"],
      ["DISCOUNT", -2_500, "PROMO_REDEMPTION", "red_1"],
    ]);
    expect(plan.resultingTotalCents).toBe(17_500);
    expect(plan.residualCents).toBe(0);
  });

  it("rebuilds several amendments in order without flattening them, from the snapshots", () => {
    const plan = planRegistrationBackfill(registration({
      totalCents: 11_000,
      redemption,
      amendments: [
        amendment("op_2", "2027-03-01T10:00:00Z", 16_000, 11_000, 2_500),
        amendment("op_1", "2027-02-01T10:00:00Z", 10_000, 16_000, 2_500),
        amendment("op_3", "2027-03-02T10:00:00Z", 11_000, 11_000, 2_500),
      ],
    }));
    expect(plan.entries.map((entry) => [entry.kind, entry.amountCents, entry.sourceId])).toEqual([
      ["CHARGE", 12_500, "reg_1"],
      ["DISCOUNT", -2_500, "red_1"],
      ["CHARGE", 6_000, "op_1"],
      ["CREDIT", -5_000, "op_2"],
    ]);
    expect(plan.entries[2]).toMatchObject({ actor: { type: "STAFF", id: "user_1", name: "Staff Sample" } });
    expect(plan.entries[2]!.createdAt).toEqual(new Date("2027-02-01T10:00:00Z"));
    expect(plan.resultingTotalCents).toBe(11_000);
    expect(plan.residualCents).toBe(0);
  });

  it("uses the discount recorded before the first amendment, since an amendment rewrites the redemption", () => {
    const plan = planRegistrationBackfill(registration({
      totalCents: 7_500,
      redemption: { ...redemption, discountAmountCents: 2_500 },
      amendments: [amendment("op_1", "2027-02-01T10:00:00Z", 17_500, 7_500, 2_500)],
    }));
    expect(plan.entries[0]!.amountCents).toBe(20_000);
    expect(plan.entries[1]!.amountCents).toBe(-2_500);
    expect(plan.residualCents).toBe(0);
  });

  it("skips what already exists, so a re-run plans nothing", () => {
    const first = planRegistrationBackfill(registration({ redemption, amendments: [amendment("op_1", "2027-02-01T10:00:00Z", 17_500, 17_500)] }));
    const second = planRegistrationBackfill(registration({
      redemption,
      amendments: [amendment("op_1", "2027-02-01T10:00:00Z", 17_500, 17_500)],
      existingKeys: new Set(first.entries.map(ledgerEntryKey)),
      existingSumCents: first.resultingTotalCents,
    }));
    expect(second.entries).toEqual([]);
    expect(second.residualCents).toBe(0);
  });

  it("reports a residual instead of inventing a balancing entry when a total moved outside the ledger", () => {
    const plan = planRegistrationBackfill(registration({
      totalCents: 18_000,
      amendments: [amendment("op_1", "2027-02-01T10:00:00Z", 10_000, 17_500)],
    }));
    expect(plan.entries.map((entry) => entry.amountCents)).toEqual([10_000, 7_500]);
    expect(plan.resultingTotalCents).toBe(17_500);
    expect(plan.residualCents).toBe(500);
  });

  it("fails closed when an amendment still to be rebuilt has no totals: nothing is planned", () => {
    const broken: BackfillAmendment = { ...amendment("op_x", "2027-02-01T10:00:00Z", 1, 2), beforeSnapshot: {}, afterSnapshot: {} };
    const plan = planRegistrationBackfill(registration({ amendments: [amendment("op_1", "2027-01-20T10:00:00Z", 10_000, 17_500), broken] }));
    expect(plan.failure).toMatch(/op_x/);
    expect(plan.entries).toEqual([]);
    // Even the first amendment missing its totals must not fall back to today's total.
    const first = planRegistrationBackfill(registration({ amendments: [broken] }));
    expect(first.failure).toMatch(/op_x/);
    expect(first.entries).toEqual([]);
  });

  it("tolerates a broken snapshot on an amendment that already has its entry", () => {
    const broken: BackfillAmendment = { ...amendment("op_x", "2027-02-01T10:00:00Z", 1, 2), beforeSnapshot: {}, afterSnapshot: {} };
    const plan = planRegistrationBackfill(registration({
      totalCents: 17_500, amendments: [broken], existingKeys: new Set(["AMENDMENT:op_x:CHARGE"]), existingSumCents: 12_000,
    }));
    expect(plan.failure).toBeNull();
    expect(plan.entries.map((entry) => entry.sourceType)).toEqual(["REGISTRATION_SUBMISSION"]);
  });

  it("plans nothing for a registration whose entries already equal its total", () => {
    const plan = planRegistrationBackfill(registration({
      redemption, totalCents: 17_500, existingKeys: new Set(["REGISTRATION_SUBMISSION:reg_1:CHARGE"]), existingSumCents: 17_500,
    }));
    expect(plan).toMatchObject({ entries: [], residualCents: 0, failure: null });
  });

  it("never plans a promo discount once the submission charge exists", () => {
    const plan = planRegistrationBackfill(registration({
      redemption, totalCents: 17_500, existingKeys: new Set(["REGISTRATION_SUBMISSION:reg_1:CHARGE"]), existingSumCents: 20_000,
    }));
    expect(plan.entries).toEqual([]);
    expect(plan.residualCents).toBe(-2_500);
  });

  it("bases the opening charge and discount on the original submission snapshot, so later outside changes stay residuals", () => {
    // Submitted at $175 after a $25 code; staff later added a $10 adjustment outside the ledger (stored total $185).
    const submissionSnapshot = { totalCents: 17_500, discountAmountCents: 2_500, currency: "USD", attendeeNames: ["Pat Example"], lineItems: [{ key: "fee", label: "Fee", amountCents: 20_000, attendeeLabel: "Pat Example", attendeeIndex: 0 }] };
    const plan = planRegistrationBackfill(registration({ totalCents: 18_500, redemption, submissionSnapshot }));
    expect(plan.entries.map((entry) => [entry.kind, entry.amountCents])).toEqual([["CHARGE", 20_000], ["DISCOUNT", -2_500]]);
    expect(plan.residualCents).toBe(1_000);
    // Without a snapshot the outside change would have been folded into the opening charge.
    const folded = planRegistrationBackfill(registration({ totalCents: 18_500, redemption }));
    expect(folded.entries[0]!.amountCents).toBe(21_000);
    expect(folded.residualCents).toBe(0);
  });

  it("keeps the submission snapshot's total for a waitlisted registration (no processing fee) exactly as stored", () => {
    const plan = planRegistrationBackfill(registration({ totalCents: 7_500, redemption, submissionSnapshot: { totalCents: 7_500, discountAmountCents: 2_500, subtotalCents: 7_500, processingFeeCents: 0 } }));
    expect(plan.resultingTotalCents).toBe(7_500);
    expect(plan.residualCents).toBe(0);
  });

  it("keeps no personal name field in any backfilled snapshot", () => {
    const named = {
      registration: { totalAmountCents: 16_000 },
      pricingSnapshot: { discountAmountCents: 0, totalCents: 16_000, attendeeNames: ["Pat Example"], currency: "USD", lineItems: [{ key: "attendees.0.fee", label: "Fee — Pat Example", amountCents: 16_000, attendeeLabel: "Pat Example", attendeeIndex: 0 }] },
    };
    const plan = planRegistrationBackfill(registration({
      totalCents: 16_000,
      submissionSnapshot: { totalCents: 10_000, attendeeNames: ["Pat Example"], lineItems: [{ key: "attendees.0.fee", label: "Fee — Pat Example", amountCents: 10_000, attendeeLabel: "Pat Example", attendeeIndex: 0 }] },
      amendments: [{ ...amendment("op_1", "2027-02-01T10:00:00Z", 10_000, 16_000), afterSnapshot: named }],
    }));
    const text = JSON.stringify(plan.entries.map((entry) => entry.pricingSnapshot));
    expect(text).not.toMatch(/Pat|Example|attendeeNames|attendeeLabel|"label"/);
    expect(text).toContain("\"key\":\"attendees.0.fee\"");
  });

  it("carries the form's currency onto reconstructed entries", () => {
    const plan = planRegistrationBackfill(registration({ submissionSnapshot: { totalCents: 17_500, currency: "CAD" } }));
    expect(plan.entries[0]!.currency).toBe("CAD");
  });

  it("attributes an amendment to a director's account or a group contact, never a staff id", () => {
    const director = { ...amendment("op_d", "2027-02-01T10:00:00Z", 1_000, 2_000), actorUserId: null, actorAttendeeAccountId: "acct_1" };
    const contact = { ...amendment("op_c", "2027-02-02T10:00:00Z", 2_000, 3_000), actorUserId: null, actorPersonId: "person_1" };
    const plan = planRegistrationBackfill(registration({ totalCents: 3_000, amendments: [director, contact] }));
    expect(plan.entries[1]).toMatchObject({ actor: { type: "ATTENDEE_ACCOUNT", id: "acct_1" } });
    expect(plan.entries[2]).toMatchObject({ actor: { type: "PERSON", id: "person_1" } });
  });
});

describe("money-only snapshots", () => {
  it("keeps line key, amount, pricing label and attendee position, and drops the label, names and everything else", () => {
    const snapshot = moneyOnlyPricingSnapshot({
      currency: "USD", totalCents: 100, subtotalCents: 100, processingFeeCents: 0, promoCode: "SAVE", attendeeNames: ["Pat Example"], contactSnapshot: { email: "pat@example.test" }, paymentCollected: false,
      lineItems: [{ key: "attendees.1.fee", label: "Fee — Pat Example", amountCents: 100, pricingLabel: "Early", attendeeIndex: 1, attendeeLabel: "Pat Example" }],
    });
    expect(snapshot).toEqual({ currency: "USD", totalCents: 100, subtotalCents: 100, processingFeeCents: 0, promoCode: "SAVE", lineItems: [{ key: "attendees.1.fee", amountCents: 100, pricingLabel: "Early", attendeeIndex: 1 }] });
    expect(moneyOnlyPricingSnapshot(null)).toEqual({});
  });

  it("strips name and contact keys at any depth as a backstop", () => {
    expect(stripPersonalKeys({ totalCents: 1, attendeeNames: ["x"], nested: [{ email: "a", amountCents: 2, firstName: "Pat" }] })).toEqual({ totalCents: 1, nested: [{ amountCents: 2 }] });
  });
});
