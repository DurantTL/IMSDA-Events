import { describe, expect, it } from "vitest";
import {
  applyPromoCodeToCalculation,
  eligibleAttendeeIndexes,
  evaluatePromoCode,
  isAttendeeTypeRestricted,
  promoAppliesToAttendeeType,
  restrictedEligibleSubtotalCents,
  type PromoCodeRule,
} from "@/modules/promo-codes/domain";
import { pricingAttendeeTypeCode } from "@/modules/attendee-types/pricing-type-code";
import type { FormCalculation, RegistrationFormDefinition } from "@/modules/forms/definition";

const rule = (overrides: Partial<PromoCodeRule> = {}): PromoCodeRule => ({
  id: "promo-1",
  code: "TEENS10",
  normalizedCode: "TEENS10",
  isActive: true,
  discountType: "PERCENT_BPS",
  discountValue: 1000,
  startsOn: null,
  endsOn: null,
  minimumSubtotalCents: null,
  maximumUses: null,
  maximumDiscountCents: null,
  redeemedCount: 0,
  ...overrides,
});

// Adult (0), Teen (1), no type (2), Teen (3); a lodging line and a registration-level fee have no attendee.
const calculation: FormCalculation = {
  subtotalCents: 50_000,
  processingFeeCents: 0,
  totalCents: 50_000,
  lineItems: [
    { key: "fee-0", label: "Registration", amountCents: 10_000, attendeeIndex: 0 },
    { key: "fee-1", label: "Registration", amountCents: 8_000, attendeeIndex: 1 },
    { key: "fee-2", label: "Registration", amountCents: 6_000, attendeeIndex: 2 },
    { key: "fee-3", label: "Registration", amountCents: 8_000, attendeeIndex: 3 },
    { key: "lodging", label: "Lodging", amountCents: 15_000 },
    { key: "reg-fee", label: "Family fee", amountCents: 3_000 },
  ],
};
const typeCodes = ["adult", "teen", null, "teen"];
const base = { submittedCode: "teens10", eligibleSubtotalCents: 50_000, pricingDate: "2027-02-01" };

describe("attendee-type restriction (#102): pure rules", () => {
  it("treats a missing or empty list as unrestricted", () => {
    expect(isAttendeeTypeRestricted(undefined)).toBe(false);
    expect(isAttendeeTypeRestricted([])).toBe(false);
    expect(isAttendeeTypeRestricted(["teen"])).toBe(true);
    expect(promoAppliesToAttendeeType([], null)).toBe(true);
    expect(promoAppliesToAttendeeType(undefined, "adult")).toBe(true);
  });

  it("applies a restricted code only to a listed type, never to an attendee with no type", () => {
    expect(promoAppliesToAttendeeType(["teen"], "teen")).toBe(true);
    expect(promoAppliesToAttendeeType(["teen"], "adult")).toBe(false);
    expect(promoAppliesToAttendeeType(["teen"], null)).toBe(false);
    expect(promoAppliesToAttendeeType(["teen"], "")).toBe(false);
  });

  it("a removed type matches nobody: the restriction narrows, it never widens to everyone", () => {
    expect(promoAppliesToAttendeeType(["old-type"], "teen")).toBe(false);
    expect(eligibleAttendeeIndexes(["old-type"], typeCodes).size).toBe(0);
  });

  it("sums only the lines of attendees of an allowed type, leaving out lodging and registration-level fees", () => {
    expect([...eligibleAttendeeIndexes(["teen"], typeCodes)]).toEqual([1, 3]);
    expect(restrictedEligibleSubtotalCents(calculation, ["teen"], typeCodes)).toBe(16_000);
    expect(restrictedEligibleSubtotalCents(calculation, ["teen", "adult"], typeCodes)).toBe(26_000);
    expect(restrictedEligibleSubtotalCents(calculation, ["child"], typeCodes)).toBe(0);
  });
});

describe("evaluating a restricted registration-level code", () => {
  const scope = { kind: "REGISTRATION" as const, calculation, attendeeTypeCodes: typeCodes };

  it("discounts only the eligible attendees' subtotal", () => {
    const evaluation = evaluatePromoCode(rule({ attendeeTypeCodes: ["teen"] }), { ...base, attendeeScope: scope });
    expect(evaluation).toMatchObject({ valid: true, eligibleSubtotalCents: 16_000, discountAmountCents: 1_600 });
  });

  it("caps a fixed discount at the eligible subtotal, not the whole subtotal", () => {
    const evaluation = evaluatePromoCode(
      rule({ attendeeTypeCodes: ["teen"], discountType: "FIXED_CENTS", discountValue: 40_000 }),
      { ...base, attendeeScope: scope },
    );
    expect(evaluation).toMatchObject({ valid: true, eligibleSubtotalCents: 16_000, discountAmountCents: 16_000 });
  });

  it("checks the minimum against the eligible subtotal", () => {
    const tooHigh = evaluatePromoCode(rule({ attendeeTypeCodes: ["teen"], minimumSubtotalCents: 20_000 }), { ...base, attendeeScope: scope });
    expect(tooHigh).toMatchObject({ valid: false, reason: "MINIMUM_NOT_MET" });
    const met = evaluatePromoCode(rule({ attendeeTypeCodes: ["teen"], minimumSubtotalCents: 16_000 }), { ...base, attendeeScope: scope });
    expect(met.valid).toBe(true);
  });

  it("rejects a registration with nobody of an allowed type", () => {
    const evaluation = evaluatePromoCode(rule({ attendeeTypeCodes: ["child"] }), { ...base, attendeeScope: scope });
    expect(evaluation).toEqual({
      valid: false,
      reason: "ATTENDEE_TYPE_NOT_ELIGIBLE",
      message: "TEENS10 doesn't apply to anyone on this registration.",
    });
  });

  it("refuses a restricted code whose type was removed", () => {
    const evaluation = evaluatePromoCode(rule({ attendeeTypeCodes: ["removed-type"] }), { ...base, attendeeScope: scope });
    expect(evaluation).toMatchObject({ valid: false, reason: "ATTENDEE_TYPE_NOT_ELIGIBLE" });
  });

  it("fails closed when a restricted code is judged without knowing who it is for", () => {
    const evaluation = evaluatePromoCode(rule({ attendeeTypeCodes: ["teen"] }), base);
    expect(evaluation).toMatchObject({ valid: false, reason: "ATTENDEE_TYPE_NOT_ELIGIBLE" });
  });

  it("never puts an amount in the refusal message", () => {
    const evaluation = evaluatePromoCode(rule({ attendeeTypeCodes: ["child"] }), { ...base, attendeeScope: scope });
    expect(evaluation.valid ? "" : evaluation.message).not.toMatch(/\$/);
  });

  it("keeps the processing fee and the stored discount consistent once applied", () => {
    const evaluation = evaluatePromoCode(rule({ attendeeTypeCodes: ["teen"] }), { ...base, attendeeScope: scope });
    if (!evaluation.valid) throw new Error("expected valid");
    const priced = applyPromoCodeToCalculation({ sections: [] } as unknown as RegistrationFormDefinition, {}, calculation, evaluation);
    expect(priced).toMatchObject({ preDiscountSubtotalCents: 50_000, discountAmountCents: 1_600, subtotalCents: 48_400 });
  });
});

describe("evaluating a restricted per-person code", () => {
  it("is valid for a person of an allowed type and prices their own share", () => {
    const evaluation = evaluatePromoCode(rule({ attendeeTypeCodes: ["teen"] }), {
      ...base, eligibleSubtotalCents: 8_000, attendeeScope: { kind: "ATTENDEE", attendeeTypeCode: "teen" },
    });
    expect(evaluation).toMatchObject({ valid: true, eligibleSubtotalCents: 8_000, discountAmountCents: 800 });
  });

  it.each(["adult", null])("is refused for a person of type %s", (attendeeTypeCode) => {
    const evaluation = evaluatePromoCode(rule({ attendeeTypeCodes: ["teen"] }), {
      ...base, eligibleSubtotalCents: 10_000, attendeeScope: { kind: "ATTENDEE", attendeeTypeCode },
    });
    expect(evaluation).toEqual({
      valid: false,
      reason: "ATTENDEE_TYPE_NOT_ELIGIBLE",
      message: "TEENS10 doesn't apply to this attendee type.",
    });
  });
});

describe("unrestricted codes are unchanged", () => {
  const unrestricted = [rule(), rule({ attendeeTypeCodes: [] })];
  const scopes = [
    undefined,
    { kind: "ATTENDEE" as const, attendeeTypeCode: null },
    { kind: "REGISTRATION" as const, calculation, attendeeTypeCodes: [] },
  ];

  it("gives the identical result whatever the scope, on the whole subtotal", () => {
    const expected = evaluatePromoCode(rule(), base);
    expect(expected).toMatchObject({ valid: true, eligibleSubtotalCents: 50_000, discountAmountCents: 5_000 });
    for (const candidate of unrestricted) {
      for (const attendeeScope of scopes) {
        expect(evaluatePromoCode(candidate, { ...base, attendeeScope })).toEqual(expected);
      }
    }
  });
});

describe("the attendee type a price rule sees (#102)", () => {
  const types = [{ code: "adult", label: "Adult" }, { code: "teen", label: "Teen" }];
  const selectorDefinition = {
    sections: [{ fields: [{ key: "attendee_type", optionSource: "ATTENDEE_TYPES" }] }],
  } as unknown as RegistrationFormDefinition;
  const plainDefinition = { sections: [{ fields: [{ key: "attendee_type" }] }] } as unknown as RegistrationFormDefinition;
  const call = (definition: RegistrationFormDefinition, answer: unknown, legacyAnswerAllowed = true) => pricingAttendeeTypeCode({
    definition, registrationResponses: {}, attendeeResponses: { attendee_type: answer }, types, legacyAnswerAllowed,
  });

  it("uses the selector's answer when the form has one, and only an active type", () => {
    expect(call(selectorDefinition, "teen")).toBe("teen");
    expect(call(selectorDefinition, "elder")).toBeNull();
    expect(call(selectorDefinition, "")).toBeNull();
  });

  it("matches the older Adult/Teen/Child answer exactly on a general event only", () => {
    expect(call(plainDefinition, "Teen")).toBe("teen");
    expect(call(plainDefinition, "Worker")).toBeNull();
    expect(call(plainDefinition, "Teen", false)).toBeNull();
  });
});
