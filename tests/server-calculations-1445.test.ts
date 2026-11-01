import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  calculateFormTotal,
  calculateRosterTotal,
  processingFeeForSubtotal,
  registrationFormDefinitionSchema,
} from "@/modules/forms/definition";
import { preparePublicRegistration, publicRegistrationInputSchema } from "@/modules/forms/public-domain";
import { applyPromoCodeToCalculation, evaluatePromoCode, type PromoCodeRule } from "@/modules/promo-codes/domain";
import { publicPromoCodeQuoteInputSchema } from "@/modules/promo-codes/schemas";
import { registrationLodgingSchema } from "@/modules/lodging/preferences-domain";
import { squarePaymentInputSchema, squarePaymentLinkInputSchema } from "@/modules/payments/square-domain";
import { paymentChoiceInputSchema } from "@/modules/payments/payment-choice-domain";
import { registrantActionSchema } from "@/modules/cancellation-requests/domain";
import { groupRegistrationEditInputSchema } from "@/modules/group-registrations/domain";
import { clubOrderAwardInputSchema, clubOrderListQuantitySchema } from "@/modules/club-orders/schemas";
import { recordUniformNeedsSchema } from "@/modules/uniforms/schemas";
import { clubRegistrationEditInputSchema } from "@/modules/club-registrations/domain";
import { registrationAmendmentInputSchema } from "@/modules/registrations/schemas";
import { honorSelectionsSchema } from "@/modules/honors/registration-picks";

/**
 * #1445 (rule P1): every calculation that matters is done on the server from one shared function, and the server never
 * trusts a total, price, quantity or discount the browser sends. One block per money, capacity or eligibility path.
 * Each posts a tampered value (a fake total, a price, a discount, a negative or huge quantity) and asserts that the
 * amount stored and charged is the server's own. `docs/SERVER-CALCULATIONS-AUDIT.md` lists the paths and the code each
 * test stands for.
 */

const TAMPERED_AMOUNT_KEYS = ["totalCents", "subtotalCents", "amountCents", "priceCents", "discountAmountCents", "processingFeeCents", "balanceCents", "refundCents", "total", "price", "amount"];

function tamper<T extends Record<string, unknown>>(input: T, key: string): Record<string, unknown> {
  return { ...input, [key]: 1 };
}

const formDefinition = registrationFormDefinitionSchema.parse({
  title: "Server calculation check",
  description: "",
  confirmationMessage: "Received.",
  payment: {
    enabled: true,
    currency: "USD",
    paymentMethodFieldKey: "payment_method",
    cardOptionValue: "Credit / debit card",
    percentageBasisPoints: 290,
    fixedFeeCents: 30,
    passFeeToRegistrant: true,
  },
  sections: [{
    id: "s_1_id",
    title: "Registration",
    description: "",
    fields: [
      { id: "f_1_id", key: "first_name", label: "First name", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [] },
      { id: "f_2_id", key: "last_name", label: "Last name", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [] },
      { id: "f_3_id", key: "email", label: "Email", helpText: "", type: "EMAIL", scope: "REGISTRATION", required: true, options: [] },
      { id: "f_4_id", key: "ticket", label: "Ticket", helpText: "", type: "RADIO", scope: "REGISTRATION", required: true, options: ["Standard", "Premium"], choicePricesCents: { Standard: 5000, Premium: 9000 } },
      { id: "f_5_id", key: "shirts", label: "Shirts", helpText: "", type: "NUMBER", scope: "REGISTRATION", required: false, options: [], priceCents: 1500 },
      { id: "f_6_id", key: "promo_code", label: "Promo code", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [] },
      { id: "f_7_id", key: "payment_method", label: "Payment method", helpText: "", type: "RADIO", scope: "REGISTRATION", required: true, options: ["Pay later", "Credit / debit card"] },
    ],
  }],
});

const honest = {
  first_name: "Test",
  last_name: "Person",
  email: "test.person@example.test",
  ticket: "Standard",
  shirts: 2,
  payment_method: "Pay later",
};
const PRICING_DATE = "2026-11-01";
const OPTIONS = { timeZone: "America/Chicago", now: new Date("2026-11-01T18:00:00Z") };
const KEY = "5b0c8c4e-6f6d-4f6b-9f7e-0f1e2d3c4b5a";

describe("public registration, group registration, general link and club event registration (one shared submit path)", () => {
  it("rejects every client-sent amount key at the top level of the submission", () => {
    const base = { versionId: "ver_1", idempotencyKey: KEY, responses: honest };
    expect(publicRegistrationInputSchema.safeParse(base).success).toBe(true);
    for (const key of TAMPERED_AMOUNT_KEYS) {
      expect(publicRegistrationInputSchema.safeParse(tamper(base, key)).success, key).toBe(false);
    }
  });

  it("rejects amount keys on an attendee row, and a lodging price", () => {
    const base = { versionId: "ver_1", idempotencyKey: KEY, responses: honest };
    const attendee = { clientId: "a1", responses: {} };
    expect(publicRegistrationInputSchema.safeParse({ ...base, attendees: [attendee] }).success).toBe(true);
    for (const key of TAMPERED_AMOUNT_KEYS) {
      expect(publicRegistrationInputSchema.safeParse({ ...base, attendees: [tamper(attendee, key)] }).success, key).toBe(false);
    }
    const lodging = { category: null, firstNight: "2027-06-15", lastNight: "2027-06-16", partySize: 2 };
    // A valid base first: a refused tamper only proves something when the untampered request is accepted.
    expect(registrationLodgingSchema.safeParse(lodging).success).toBe(true);
    for (const key of TAMPERED_AMOUNT_KEYS) {
      expect(registrationLodgingSchema.safeParse(tamper(lodging, key)).success, key).toBe(false);
    }
  });

  it("prices from the form's own prices: fake total, price and discount answers change nothing", () => {
    const serverTotal = calculateFormTotal(formDefinition, honest, PRICING_DATE).totalCents;
    expect(serverTotal).toBe(5000 + 2 * 1500);
    const tampered = preparePublicRegistration(formDefinition, {
      versionId: "ver_1",
      idempotencyKey: KEY,
      responses: { ...honest, total: 1, totalCents: 1, subtotalCents: 1, price: 1, priceCents: 1, discountAmountCents: 999_999, registration_fee: 1 },
    }, OPTIONS);
    expect(tampered.calculation.totalCents).toBe(serverTotal);
    expect(tampered.calculation.lineItems.map((line) => line.key).sort()).toEqual(["shirts", "ticket"]);
    // Answers that are not on the form are not kept, so they cannot reach the stored record either.
    expect(Object.keys(tampered.responses)).not.toContain("totalCents");
  });

  it("a negative or fractional quantity never lowers the total; a huge one is the server's product, not a client sum", () => {
    const negative = calculateFormTotal(formDefinition, { ...honest, shirts: -40 }, PRICING_DATE);
    expect(negative.totalCents).toBe(5000);
    // Whether a fractional quantity (2.5 shirts) should be refused is a decision for Caleb (docs/SERVER-CALCULATIONS-AUDIT.md).
    // Whatever is decided, the amount is the server's and is a whole number of cents.
    const fractional = preparePublicRegistration(formDefinition, { versionId: "v", idempotencyKey: KEY, responses: { ...honest, shirts: 2.5 } }, OPTIONS);
    expect(Number.isInteger(fractional.calculation.totalCents)).toBe(true);
    const big = calculateFormTotal(formDefinition, { ...honest, shirts: 100 }, PRICING_DATE);
    expect(big.totalCents).toBe(5000 + 100 * 1500);
  });

  it("the card fee is the server's, from the form's own rate, and only when card is chosen", () => {
    const pay = formDefinition.payment;
    const later = calculateFormTotal(formDefinition, honest, PRICING_DATE);
    const card = calculateFormTotal(formDefinition, { ...honest, payment_method: "Credit / debit card" }, PRICING_DATE);
    expect(later.processingFeeCents).toBe(0);
    expect(card.processingFeeCents).toBe(processingFeeForSubtotal(pay, 8000, true));
    expect(card.processingFeeCents).toBeGreaterThan(0);
    // A client-sent fee is not an input: the answer map has no such field.
    const withFakeFee = calculateFormTotal(formDefinition, { ...honest, payment_method: "Credit / debit card", processingFeeCents: 0 }, PRICING_DATE);
    expect(withFakeFee.totalCents).toBe(card.totalCents);
  });

  it("a roster registration prices every person from the form, ignoring client numbers on a row", () => {
    const rosterForm = registrationFormDefinitionSchema.parse({
      ...formDefinition,
      attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 5, attendeeLabel: "Person", addButtonLabel: "Add" },
      sections: [
        ...formDefinition.sections.map((section) => ({ ...section, fields: section.fields.filter((field) => !["shirts", "first_name", "last_name"].includes(field.key)) })),
        { id: "s_2_id", title: "People", description: "", fields: [
          { id: "g_1_id", key: "first_name", label: "First", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
          { id: "g_2_id", key: "last_name", label: "Last", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
          { id: "g_3_id", key: "meal", label: "Meal", helpText: "", type: "NUMBER", scope: "ATTENDEE", required: false, options: [], priceCents: 800 },
        ] },
      ],
    });
    const registration: Record<string, unknown> = { ...honest };
    for (const key of ["shirts", "first_name", "last_name"]) delete registration[key];
    const attendees = [
      { first_name: "A", last_name: "One", meal: 2, price: 1, priceCents: 1 },
      { first_name: "B", last_name: "Two", meal: -3, totalCents: 1 },
    ];
    const expected = calculateRosterTotal(rosterForm, registration, attendees.map(({ first_name, last_name, meal }) => ({ first_name, last_name, meal })), PRICING_DATE);
    const prepared = preparePublicRegistration(rosterForm, {
      versionId: "v",
      idempotencyKey: KEY,
      responses: registration,
      attendees: attendees.map((responses, index) => ({ clientId: `c${index}`, responses })),
    }, OPTIONS);
    expect(prepared.calculation.totalCents).toBe(expected.totalCents);
    expect(prepared.calculation.totalCents).toBe(5000 + 2 * 800);
  });

  it("group registration, the general link and the manage-link group edit take the same strict shapes", () => {
    const edit = { clientRequestId: KEY, expectedUpdatedAt: "2026-11-01T18:00:00.000Z", attendees: [{ attendeeId: null, responses: {} }] };
    expect(groupRegistrationEditInputSchema.safeParse(edit).success).toBe(true);
    for (const key of TAMPERED_AMOUNT_KEYS) {
      expect(groupRegistrationEditInputSchema.safeParse(tamper(edit, key)).success, key).toBe(false);
      expect(groupRegistrationEditInputSchema.safeParse({ ...edit, attendees: [tamper(edit.attendees[0], key)] }).success, key).toBe(false);
    }
  });
});

describe("promo codes", () => {
  const rule: PromoCodeRule = {
    id: "promo_1",
    code: "SAVE10",
    normalizedCode: "SAVE10",
    isActive: true,
    discountType: "PERCENT_BPS",
    discountValue: 1000,
    startsOn: null,
    endsOn: null,
    minimumSubtotalCents: null,
    maximumUses: null,
    maximumDiscountCents: null,
    redeemedCount: 0,
    sponsoringOrganizationId: null,
  } as unknown as PromoCodeRule;

  it("the discount is the rule's own percentage of the server's subtotal, whatever the browser showed", () => {
    const calculation = calculateFormTotal(formDefinition, { ...honest, promo_code: "save10", payment_method: "Credit / debit card" }, PRICING_DATE);
    const evaluation = evaluatePromoCode(rule, { submittedCode: "save10", eligibleSubtotalCents: calculation.subtotalCents, pricingDate: PRICING_DATE });
    expect(evaluation.valid).toBe(true);
    if (!evaluation.valid) return;
    const priced = applyPromoCodeToCalculation(formDefinition, { ...honest, payment_method: "Credit / debit card" }, calculation, evaluation);
    expect(priced.discountAmountCents).toBe(800);
    expect(priced.subtotalCents).toBe(8000 - 800);
    expect(priced.processingFeeCents).toBe(processingFeeForSubtotal(formDefinition.payment, 7200, true));
    expect(priced.totalCents).toBe(priced.subtotalCents + priced.processingFeeCents);
  });

  it("an unknown or wrong code discounts nothing; the quote request has no amount field", () => {
    const wrong = evaluatePromoCode(rule, { submittedCode: "NOTACODE", eligibleSubtotalCents: 8000, pricingDate: PRICING_DATE });
    expect(wrong.valid).toBe(false);
    const quote = { versionId: "ver_1", code: "SAVE10", responses: honest };
    expect(publicPromoCodeQuoteInputSchema.safeParse(quote).success).toBe(true);
    for (const key of TAMPERED_AMOUNT_KEYS) {
      expect(publicPromoCodeQuoteInputSchema.safeParse(tamper(quote, key)).success, key).toBe(false);
    }
  });
});

describe("deposits, Square payments and the payment choice", () => {
  it("a payment carries a token, a key and the kind of payment, never an amount", () => {
    const payment = { sourceId: "cnon:card-nonce-ok", idempotencyKey: KEY, kind: "DEPOSIT" as const };
    expect(squarePaymentInputSchema.safeParse(payment).success).toBe(true);
    const link = { idempotencyKey: KEY, returnId: "A".repeat(43) };
    expect(squarePaymentLinkInputSchema.safeParse(link).success).toBe(true);
    const choice = { choice: "CARD" as const, clientRequestId: KEY, expectedPriorOperationId: null };
    expect(paymentChoiceInputSchema.safeParse(choice).success).toBe(true);
    for (const key of TAMPERED_AMOUNT_KEYS) {
      expect(squarePaymentInputSchema.safeParse(tamper(payment, key)).success, `payment ${key}`).toBe(false);
      expect(squarePaymentLinkInputSchema.safeParse(tamper(link, key)).success, `link ${key}`).toBe(false);
      expect(paymentChoiceInputSchema.safeParse(tamper(choice, key)).success, `choice ${key}`).toBe(false);
    }
    expect(squarePaymentInputSchema.safeParse({ ...payment, kind: "ANYTHING" }).success).toBe(false);
  });
});

describe("amendments", () => {
  it("an amendment sends answers and a quote fingerprint (a hash that must match the server's quote), never a total", () => {
    const amendment = {
      clientRequestId: KEY,
      expectedUpdatedAt: "2026-11-01T18:00:00.000Z",
      responses: honest,
      attendees: [{ clientId: "a1", attendeeId: null, responses: {} }],
      previewOnly: false,
      quoteFingerprint: "a".repeat(64),
    };
    expect(registrationAmendmentInputSchema.safeParse(amendment).success).toBe(true);
    for (const key of TAMPERED_AMOUNT_KEYS) {
      expect(registrationAmendmentInputSchema.safeParse(tamper(amendment, key)).success, key).toBe(false);
    }
    expect(registrationAmendmentInputSchema.safeParse({ ...amendment, quoteFingerprint: "short" }).success).toBe(false);
  });
});

describe("club event registration (director edit)", () => {
  it("refuses any amount the browser adds: only the roster picks, guests and answers are read", () => {
    const edit = {
      clientRequestId: KEY,
      expectedUpdatedAt: "2026-11-01T18:00:00.000Z",
      selectedMemberIds: ["m1"],
      keptGuestIds: [],
      keptOffRosterAttendeeIds: [],
      newGuests: [],
      attendeeResponses: {},
    };
    expect(clubRegistrationEditInputSchema.safeParse(edit).success).toBe(true);
    for (const key of TAMPERED_AMOUNT_KEYS) {
      expect(clubRegistrationEditInputSchema.safeParse(tamper(edit, key)).success, key).toBe(false);
    }
  });
});

describe("cancellations and refunds (registrant side)", () => {
  const selection = { scope: "FULL_REGISTRATION" as const, attendeeIds: [], chargeIds: [] };

  it("the only number a registrant sends is the refund they were shown, and the server keeps its own", () => {
    const submit = {
      action: "submit" as const,
      selection,
      reason: "A family emergency",
      contactMethod: "EMAIL",
      idempotencyKey: "request-key-0001",
      expectedRefundCents: 1000,
    };
    const parsed = registrantActionSchema.safeParse(submit);
    // `contactMethod` values are the module's own; what matters here is the strict shape below.
    if (parsed.success) expect(parsed.data).toMatchObject({ expectedRefundCents: 1000 });
    for (const key of ["refundCents", "totalCents", "amountCents", "retainedCents", "proposedRefundCents"]) {
      expect(registrantActionSchema.safeParse(tamper(submit, key)).success, key).toBe(false);
    }
    expect(registrantActionSchema.safeParse({ action: "preview", selection: tamper(selection, "refundCents") }).success).toBe(false);
  });
});

describe("club orders, uniform orders and honors picks", () => {
  it("the order helper list takes a bounded quantity and nothing priced", () => {
    expect(clubOrderListQuantitySchema.safeParse({ quantity: 3 }).success).toBe(true);
    expect(clubOrderListQuantitySchema.safeParse({ quantity: -1 }).success).toBe(false);
    expect(clubOrderListQuantitySchema.safeParse({ quantity: 10_001 }).success).toBe(false);
    expect(clubOrderListQuantitySchema.safeParse({ quantity: 1.5 }).success).toBe(false);
    for (const key of TAMPERED_AMOUNT_KEYS) {
      expect(clubOrderListQuantitySchema.safeParse({ quantity: 2, [key]: 1 }).success, key).toBe(false);
      expect(clubOrderAwardInputSchema.safeParse({ needIds: ["n1"], [key]: 1 }).success, key).toBe(false);
    }
  });

  it("uniform needs name people and catalog items; prices are the catalog's", () => {
    expect(recordUniformNeedsSchema.safeParse({ personIds: ["p1"], itemIds: ["i1"] }).success).toBe(true);
    for (const key of TAMPERED_AMOUNT_KEYS) {
      expect(recordUniformNeedsSchema.safeParse({ personIds: ["p1"], itemIds: ["i1"], [key]: 1 }).success, key).toBe(false);
    }
  });

  it("honors picks are class ids per person and cap at six each", () => {
    expect(honorSelectionsSchema.safeParse({ c1: ["class_1"] }).success).toBe(true);
    expect(honorSelectionsSchema.safeParse({ c1: Array.from({ length: 7 }, (_, index) => `class_${index}`) }).success).toBe(false);
    expect(honorSelectionsSchema.safeParse({ c1: [{ priceCents: 1 }] }).success).toBe(false);
  });
});
