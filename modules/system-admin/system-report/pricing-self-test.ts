import {
  calculateFormTotal,
  registrationFormDefinitionSchema,
  type RegistrationFormDefinition,
} from "@/modules/forms/definition";
import { depositDueCents } from "@/modules/payments/deposit-domain";
import { cardSurchargeForBalance } from "@/modules/payments/square-domain";
import { storedPromoDiscount } from "@/modules/promo-codes/stored-discount";

/**
 * The pricing self-test (#1375). It runs the real pricing functions on one fixed, in-memory fixture and compares each
 * answer with a figure written down here. It reads nothing from the database and holds no real amounts, so a difference
 * means the arithmetic changed, not that any registration is wrong. Pure.
 *
 * Fixture, worked by hand: a "Deluxe" package at $80.00 (early-bird) or $90.00 (from 2026-11-01), plus 3 shirts at
 * $15.00 each, paid by card with the 2.9% + $0.30 fee passed on. Early: subtotal 12,500; fee = ceil(12,530 / 0.971) -
 * 12,500 = 405. Late: subtotal 13,500; fee = ceil(13,530 / 0.971) - 13,500 = 435.
 */

export type PricingCalculationName =
  | "early-bird total"
  | "late price total"
  | "quantity line"
  | "percent promo code"
  | "promo code below minimum"
  | "fixed promo code"
  | "deposit"
  | "deposit capped at balance"
  | "card surcharge";

export type PricingExpected = Record<PricingCalculationName, number>;

export const PRICING_EXPECTED: PricingExpected = {
  "early-bird total": 12_905,
  "late price total": 13_935,
  "quantity line": 4_500,
  "percent promo code": 1_000,
  "promo code below minimum": 0,
  "fixed promo code": 2_000,
  deposit: 5_000,
  "deposit capped at balance": 3_000,
  "card surcharge": 405,
};

function fixtureDefinition(): RegistrationFormDefinition {
  return registrationFormDefinitionSchema.parse({
    title: "Pricing self-test",
    description: "",
    confirmationMessage: "Done",
    payment: { enabled: true, currency: "USD", paymentMethodFieldKey: "payment_method", cardOptionValue: "Card", percentageBasisPoints: 290, fixedFeeCents: 30, passFeeToRegistrant: true },
    sections: [{
      id: "s_main",
      title: "Main",
      description: "",
      fields: [
        {
          id: "f_package", key: "package", label: "Package", helpText: "", type: "SELECT", scope: "REGISTRATION", required: false,
          options: ["Standard", "Deluxe"],
          choicePricesCents: { Standard: 5000, Deluxe: 8000 },
          latePricing: { startsOn: "2026-11-01", label: "Late", choicePricesCents: { Standard: 6000, Deluxe: 9000 } },
        },
        { id: "f_shirts", key: "shirts", label: "Shirts", helpText: "", type: "NUMBER", scope: "REGISTRATION", required: false, options: [], priceCents: 1500 },
        { id: "f_method", key: "payment_method", label: "Payment method", helpText: "", type: "SELECT", scope: "REGISTRATION", required: false, options: ["Card", "Check"] },
      ],
    }],
  });
}

const RESPONSES = { package: "Deluxe", shirts: 3, payment_method: "Card" };
const EARLY_DATE = "2026-10-01";
const LATE_DATE = "2026-11-02";

function computeActual(): PricingExpected {
  const definition = fixtureDefinition();
  const early = calculateFormTotal(definition, RESPONSES, EARLY_DATE);
  const late = calculateFormTotal(definition, RESPONSES, LATE_DATE);
  const percent = { discountType: "PERCENT_BPS" as const, discountValue: 1000, maximumDiscountCents: 1000, minimumSubtotalCents: 5000 };
  const fixed = { discountType: "FIXED_CENTS" as const, discountValue: 2000, maximumDiscountCents: null, minimumSubtotalCents: null };
  const deposit = { amountCents: 5000, optionValue: "Deposit" };
  return {
    "early-bird total": early.totalCents,
    "late price total": late.totalCents,
    "quantity line": early.lineItems.find((item) => item.key === "shirts")?.amountCents ?? -1,
    "percent promo code": storedPromoDiscount(percent, early.subtotalCents).discountCents,
    "promo code below minimum": storedPromoDiscount(percent, 4000).discountCents,
    "fixed promo code": storedPromoDiscount(fixed, early.subtotalCents).discountCents,
    deposit: depositDueCents(deposit, early.subtotalCents),
    "deposit capped at balance": depositDueCents(deposit, 3000),
    "card surcharge": cardSurchargeForBalance(definition, early.subtotalCents),
  };
}

export type PricingSelfTestResult = { checked: number; differed: PricingCalculationName[] };

/** Throws if the fixture cannot be priced at all. `expected` is a parameter only so a test can prove a wrong figure is caught. */
export function runPricingSelfTest(expected: PricingExpected = PRICING_EXPECTED): PricingSelfTestResult {
  const actual = computeActual();
  const names = Object.keys(expected) as PricingCalculationName[];
  return { checked: names.length, differed: names.filter((name) => actual[name] !== expected[name]) };
}
