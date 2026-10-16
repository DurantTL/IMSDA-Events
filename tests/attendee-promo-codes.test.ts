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

  describe("a church code is the registration's only code (#961)", () => {
    const byCode = (sponsored: Record<string, string | null>) => mocks.findUnique.mockImplementation(
      async ({ where }: { where: { eventId_normalizedCode: { normalizedCode: string } } }) => {
        const code = where.eventId_normalizedCode.normalizedCode;
        return code in sponsored
          ? promo({ id: `promo-${code}`, code, normalizedCode: code, sponsoringOrganizationId: sponsored[code] })
          : null;
      },
    );
    const run = (codes: string[], claim: boolean) => evaluateAttendeePromoCodes(client as never, {
      eventId: "event-1", field, attendees: attendees(codes), calculation: threePeople, pricingDate: "2026-06-01", claim,
    });

    it("refuses a second code beside a church code, and a second church code, when previewing and claiming", async () => {
      byCode({ CHURCH: "church-1", OTHERCHURCH: "church-2", EARLY: null });
      for (const claim of [false, true]) {
        mocks.updateMany.mockClear();
        const mixed = await run(["CHURCH", "EARLY", "church"], claim);
        expect(mixed.discounts.map((discount) => discount.attendeeIndex)).toEqual([0, 2]);
        expect(mixed.issues).toEqual([expect.objectContaining({
          attendeeIndex: 1,
          message: "A church-sponsored code can't be combined with another promo code on one registration. CHURCH is already used for another person here.",
        })]);
        // The refused code never takes a use.
        expect(mocks.updateMany).toHaveBeenCalledTimes(claim ? 2 : 0);
        const reversed = await run(["EARLY", "CHURCH"], claim);
        expect(reversed.issues.map((issue) => issue.attendeeIndex)).toEqual([1]);
        const twoChurches = await run(["CHURCH", "OTHERCHURCH"], claim);
        expect(twoChurches.issues.map((issue) => issue.attendeeIndex)).toEqual([1]);
      }
    });

    it("still allows different ordinary codes for different people (#397)", async () => {
      byCode({ EARLY: null, LATE: null });
      for (const claim of [false, true]) {
        const { discounts, issues } = await run(["EARLY", "LATE", "early"], claim);
        expect(issues).toEqual([]);
        expect(discounts.map((discount) => discount.code)).toEqual(["EARLY", "LATE", "EARLY"]);
      }
    });

    it("does not let a mistyped first code block a valid one after it", async () => {
      byCode({ CHURCH: "church-1", OTHERCHURCH: "church-2" });
      for (const claim of [false, true]) {
        const { discounts, issues } = await run(["TYPO", "CHURCH", "OTHERCHURCH"], claim);
        expect(discounts.map((discount) => discount.attendeeIndex)).toEqual([1]);
        expect(issues.map((issue) => issue.attendeeIndex)).toEqual([0, 2]);
      }
    });
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
