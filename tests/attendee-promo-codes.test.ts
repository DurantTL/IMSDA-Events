import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), updateMany: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));

const client = { promoCode: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } };

import { applyAttendeePromoCodes, attendeeShareCents } from "@/modules/promo-codes/domain";
import { evaluateAttendeePromoCodes } from "@/modules/promo-codes/repository";
import type { FormCalculation, RegistrationFormDefinition } from "@/modules/forms/definition";

const calculation: FormCalculation = {
  subtotalCents: 27000,
  processingFeeCents: 0,
  totalCents: 27000,
  lineItems: [
    { key: "fee-0", label: "Registration", amountCents: 14500, attendeeIndex: 0 },
    { key: "fee-1", label: "Registration", amountCents: 12500, attendeeIndex: 1 },
  ],
};

function promo(overrides: Record<string, unknown> = {}) {
  return {
    id: "promo-early",
    code: "EARLY",
    normalizedCode: "EARLY",
    isActive: true,
    discountType: "FIXED_CENTS",
    discountValue: 2000,
    startsOn: null,
    endsOn: null,
    minimumSubtotalCents: null,
    maximumUses: null,
    maximumDiscountCents: null,
    redeemedCount: 0,
    ...overrides,
  };
}

const threePeople: FormCalculation = {
  ...calculation,
  lineItems: [...calculation.lineItems, { key: "fee-2", label: "Registration", amountCents: 9000, attendeeIndex: 2 }],
};
const field = { id: "field-promo", key: "promo_code" };
const attendees = (codes: string[]) => codes.map((code) => ({ responses: { promo_code: code } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockResolvedValue(promo());
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe("per-person promo codes (#397)", () => {
  it("prices each code on that person's share", async () => {
    mocks.findUnique.mockResolvedValue(promo({ discountType: "PERCENT_BPS", discountValue: 1000 }));
    const { discounts, issues } = await evaluateAttendeePromoCodes(client as never, {
      eventId: "event-1", field, attendees: attendees(["early", "early"]), calculation, pricingDate: "2026-06-01", claim: false,
    });
    expect(issues).toEqual([]);
    expect(discounts.map((discount) => discount.discountAmountCents)).toEqual([1450, 1250]);
    expect(attendeeShareCents(calculation, 1)).toBe(12500);
  });

  it("warns when the same code is entered more times than it has uses left", async () => {
    mocks.findUnique.mockResolvedValue(promo({ maximumUses: 5, redeemedCount: 4 }));
    const { discounts, issues } = await evaluateAttendeePromoCodes(client as never, {
      eventId: "event-1", field, attendees: attendees(["EARLY", "EARLY"]), calculation, pricingDate: "2026-06-01", claim: false,
    });
    expect(discounts).toHaveLength(1);
    expect(issues).toEqual([expect.objectContaining({
      attendeeIndex: 1,
      path: "attendees.1.responses.promo_code",
      message: "EARLY has no uses left for another person in this registration.",
    })]);
  });

  it("explains unknown or expired codes on that person, and skips blank ones", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const unknown = await evaluateAttendeePromoCodes(client as never, {
      eventId: "event-1", field, attendees: [...attendees(["NOPE"]), { responses: {} }], calculation, pricingDate: "2026-06-01", claim: false,
    });
    expect(unknown.discounts).toEqual([]);
    expect(unknown.issues.map((issue) => [issue.attendeeIndex, issue.message])).toEqual([
      [0, "That promo code was not recognized. Check the spelling and try again."],
    ]);
    mocks.findUnique.mockResolvedValue(promo({ endsOn: "2026-05-01" }));
    const ended = await evaluateAttendeePromoCodes(client as never, {
      eventId: "event-1", field, attendees: [{ responses: {} }, ...attendees(["EARLY"])], calculation, pricingDate: "2026-06-01", claim: false,
    });
    expect(ended.discounts).toEqual([]);
    expect(ended.issues.map((issue) => [issue.attendeeIndex, issue.message])).toEqual([
      [1, "That promo code ended on 2026-05-01."],
    ]);
  });

  it("claims one use per person at submission", async () => {
    const { discounts } = await evaluateAttendeePromoCodes(client as never, {
      eventId: "event-1", field, attendees: attendees(["EARLY", "EARLY"]), calculation, pricingDate: "2026-06-01", claim: true,
    });
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    expect(discounts.every((discount) => discount.promoCodeId === "promo-early")).toBe(true);
  });

  it("covers only the ticked people; the rest pay for themselves and use no code (#961)", async () => {
    const { discounts, issues } = await evaluateAttendeePromoCodes(client as never, {
      eventId: "event-1", field, attendees: attendees(["EARLY", "", "early"]), calculation: threePeople, pricingDate: "2026-06-01", claim: true,
    });
    expect(issues).toEqual([]);
    expect(discounts.map((discount) => discount.attendeeIndex)).toEqual([0, 2]);
    // A use is counted for each person who received the code, and for nobody else.
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
  });

  it("applies only one code per registration, when previewing and when claiming (#961)", async () => {
    mocks.findUnique.mockImplementation(async ({ where }: { where: { eventId_normalizedCode: { normalizedCode: string } } }) => promo({
      id: `promo-${where.eventId_normalizedCode.normalizedCode}`,
      code: where.eventId_normalizedCode.normalizedCode,
      normalizedCode: where.eventId_normalizedCode.normalizedCode,
    }));
    for (const claim of [false, true]) {
      mocks.updateMany.mockClear();
      const { discounts, issues } = await evaluateAttendeePromoCodes(client as never, {
        eventId: "event-1", field, attendees: attendees(["EARLY", "late", "Early"]), calculation: threePeople, pricingDate: "2026-06-01", claim,
      });
      expect(discounts.map((discount) => discount.attendeeIndex)).toEqual([0, 2]);
      expect(issues).toEqual([expect.objectContaining({
        attendeeIndex: 1,
        message: "Only one promo code can be used on a registration. EARLY is already used for another person here.",
      })]);
      // The refused second code never takes a use.
      expect(mocks.updateMany).toHaveBeenCalledTimes(claim ? 2 : 0);
    }
  });

  it("totals the discounts and recalculates the card fee on the discounted amount", () => {
    const definition = {
      payment: { enabled: true, currency: "USD", paymentMethodFieldKey: "payment_method", cardOptionValue: "Card", passFeeToRegistrant: true, percentageBasisPoints: 290, fixedFeeCents: 30 },
    } as unknown as RegistrationFormDefinition;
    const priced = applyAttendeePromoCodes(definition, { payment_method: "Card" }, calculation, [
      { attendeeIndex: 0, code: "EARLY", discountAmountCents: 2000 },
      { attendeeIndex: 1, code: "CHURCH", discountAmountCents: 12500 },
    ]);
    expect(priced.discountAmountCents).toBe(14500);
    expect(priced.subtotalCents).toBe(12500);
    expect(priced.promoCode).toBe("EARLY, CHURCH");
    expect(priced.processingFeeCents).toBeGreaterThan(0);
    expect(priced.totalCents).toBe(priced.subtotalCents + priced.processingFeeCents);
  });
});
