import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  promoFindUnique: vi.fn(),
  promoUpdateMany: vi.fn(),
  promoCreate: vi.fn(),
  promoFindFirst: vi.fn(),
  promoFindMany: vi.fn(),
  typeFindMany: vi.fn(),
  eventFindUnique: vi.fn(),
  redemptionCreate: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("server-only", () => ({}));

const tx = {
  promoCode: {
    findUnique: mocks.promoFindUnique,
    updateMany: mocks.promoUpdateMany,
    create: mocks.promoCreate,
    findFirst: mocks.promoFindFirst,
    findMany: mocks.promoFindMany,
  },
  eventAttendeeType: { findMany: mocks.typeFindMany },
  event: { findUnique: mocks.eventFindUnique },
  promoCodeRedemption: { create: mocks.redemptionCreate },
  auditLog: { create: mocks.auditCreate },
};
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({ ...tx, $transaction: async (work: (client: typeof tx) => unknown) => work(tx) }),
}));

import {
  claimPromoCode,
  createPromoCode,
  evaluateAttendeePromoCodes,
  PromoCodeOperationError,
  PublicPromoCodeError,
  recordPromoCodeRedemption,
  updatePromoCode,
} from "@/modules/promo-codes/repository";
import type { FormCalculation } from "@/modules/forms/definition";

function storedPromo(overrides: Record<string, unknown> = {}) {
  return {
    id: "promo-1",
    eventId: "event-1",
    code: "TEENS10",
    normalizedCode: "TEENS10",
    isActive: true,
    discountType: "PERCENT_BPS" as const,
    discountValue: 1000,
    startsOn: null,
    endsOn: null,
    minimumSubtotalCents: null,
    maximumUses: null,
    maximumDiscountCents: null,
    redeemedCount: 0,
    sponsoringOrganizationId: null,
    attendeeTypeCodes: ["teen"],
    createdAt: new Date("2027-01-01T12:00:00.000Z"),
    updatedAt: new Date("2027-01-01T12:00:00.000Z"),
    ...overrides,
  };
}

// Adult (0), Teen (1); lodging has no attendee.
const calculation: FormCalculation = {
  subtotalCents: 30_000,
  processingFeeCents: 0,
  totalCents: 30_000,
  lineItems: [
    { key: "fee-0", label: "Registration", amountCents: 10_000, attendeeIndex: 0 },
    { key: "fee-1", label: "Registration", amountCents: 8_000, attendeeIndex: 1 },
    { key: "lodging", label: "Lodging", amountCents: 12_000 },
  ],
};
const field = { id: "field-promo", key: "promo_code" };
const people = [{ responses: { promo_code: "teens10" } }, { responses: { promo_code: "teens10" } }];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.promoFindUnique.mockResolvedValue(storedPromo());
  mocks.promoUpdateMany.mockResolvedValue({ count: 1 });
});

describe("per-person restricted codes (#102)", () => {
  it("is valid for the allowed type and refused, with no amounts, for the other", async () => {
    const { discounts, issues } = await evaluateAttendeePromoCodes(tx as never, {
      eventId: "event-1", field, attendees: people, attendeeTypeCodes: ["adult", "teen"], calculation, pricingDate: "2027-02-01", claim: false,
    });
    expect(discounts).toEqual([{ attendeeIndex: 1, code: "TEENS10", discountAmountCents: 800 }]);
    expect(issues).toEqual([expect.objectContaining({
      attendeeIndex: 0,
      path: "attendees.0.responses.promo_code",
      message: "TEENS10 doesn't apply to this attendee type.",
    })]);
    expect(issues[0]!.message).not.toMatch(/\$/);
  });

  it("claims a use only for the allowed person on submission", async () => {
    const { discounts, issues } = await evaluateAttendeePromoCodes(tx as never, {
      eventId: "event-1", field, attendees: people, attendeeTypeCodes: ["adult", "teen"], calculation, pricingDate: "2027-02-01", claim: true,
    });
    expect(discounts).toEqual([expect.objectContaining({ attendeeIndex: 1, promoCodeId: "promo-1", discountAmountCents: 800 })]);
    expect(issues).toHaveLength(1);
    expect(mocks.promoUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("an attendee with no known type never matches a restricted code", async () => {
    const { discounts, issues } = await evaluateAttendeePromoCodes(tx as never, {
      eventId: "event-1", field, attendees: people, calculation, pricingDate: "2027-02-01", claim: false,
    });
    expect(discounts).toEqual([]);
    expect(issues).toHaveLength(2);
  });

  it("leaves an unrestricted code exactly as before, with or without type codes", async () => {
    mocks.promoFindUnique.mockResolvedValue(storedPromo({ attendeeTypeCodes: [] }));
    for (const attendeeTypeCodes of [undefined, ["adult", "teen"], [null, null]]) {
      const { discounts, issues } = await evaluateAttendeePromoCodes(tx as never, {
        eventId: "event-1", field, attendees: people, attendeeTypeCodes, calculation, pricingDate: "2027-02-01", claim: false,
      });
      expect(issues).toEqual([]);
      expect(discounts.map((discount) => discount.discountAmountCents)).toEqual([1000, 800]);
    }
  });
});

describe("registration-level restricted claim (#102)", () => {
  const claim = (attendeeTypeCodes: Array<string | null>) => claimPromoCode(tx as never, {
    eventId: "event-1",
    submittedCode: "teens10",
    eligibleSubtotalCents: calculation.subtotalCents,
    pricingDate: "2027-02-01",
    fieldId: "field-promo",
    attendeeScope: { kind: "REGISTRATION", calculation, attendeeTypeCodes },
  });

  it("discounts only the allowed attendees' lines, leaving lodging out", async () => {
    const claimed = await claim(["adult", "teen"]);
    expect(claimed.evaluation).toMatchObject({ eligibleSubtotalCents: 8_000, discountAmountCents: 800 });
    expect(mocks.promoUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("rejects, taking no use, when nobody on the registration is of an allowed type", async () => {
    await expect(claim(["adult", "adult"])).rejects.toMatchObject({
      reason: "ATTENDEE_TYPE_NOT_ELIGIBLE",
      message: "TEENS10 doesn't apply to anyone on this registration.",
    });
    await expect(claim(["adult", "adult"])).rejects.toBeInstanceOf(PublicPromoCodeError);
    expect(mocks.promoUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses a restricted code claimed with no scope at all (fail closed)", async () => {
    await expect(claimPromoCode(tx as never, {
      eventId: "event-1", submittedCode: "teens10", eligibleSubtotalCents: 30_000, pricingDate: "2027-02-01", fieldId: "f",
    })).rejects.toMatchObject({ reason: "ATTENDEE_TYPE_NOT_ELIGIBLE" });
    expect(mocks.promoUpdateMany).not.toHaveBeenCalled();
  });

  it("an unrestricted code still discounts the whole subtotal", async () => {
    mocks.promoFindUnique.mockResolvedValue(storedPromo({ attendeeTypeCodes: [] }));
    const claimed = await claim(["adult", "teen"]);
    expect(claimed.evaluation).toMatchObject({ eligibleSubtotalCents: 30_000, discountAmountCents: 3_000 });
  });

  it("records the restriction that was promised on the redemption", async () => {
    mocks.redemptionCreate.mockResolvedValue({ id: "red-1" });
    const claimed = await claim(["adult", "teen"]);
    await recordPromoCodeRedemption(tx as never, { eventId: "event-1", registrationId: "reg-1", claimed });
    expect(mocks.redemptionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ attendeeTypeCodesSnapshot: ["teen"], eligibleSubtotalCents: 8_000, discountAmountCents: 800 }),
    });
  });
});

describe("staff setting the restriction (#102)", () => {
  const create = { code: "TEENS10", isActive: true, discountType: "FIXED_CENTS" as const, discountValue: 500, startsOn: null, endsOn: null, minimumSubtotalCents: null, maximumUses: null, maximumDiscountCents: null };

  beforeEach(() => {
    mocks.eventFindUnique.mockResolvedValue({ id: "event-1", timezone: "America/Chicago" });
    mocks.promoCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "promo-9", ...data }));
    mocks.promoFindMany.mockResolvedValue([]);
    mocks.typeFindMany.mockResolvedValue([]);
  });

  it("saves a deduplicated list of the event's active attendee types", async () => {
    mocks.typeFindMany.mockResolvedValueOnce([{ code: "teen", isActive: true }, { code: "adult", isActive: true }]);
    await createPromoCode("event-1", { ...create, attendeeTypeCodes: ["teen", "adult", "teen"] } as never, "user-1");
    expect(mocks.typeFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { eventId: "event-1", code: { in: ["teen", "adult"] } } }));
    expect(mocks.promoCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ attendeeTypeCodes: ["teen", "adult"] }) });
  });

  it("rejects a code that is not one of the event's attendee types", async () => {
    mocks.typeFindMany.mockResolvedValueOnce([{ code: "teen", isActive: true }]);
    await expect(createPromoCode("event-1", { ...create, attendeeTypeCodes: ["teen", "nope"] } as never, "user-1"))
      .rejects.toMatchObject({ code: "PROMO_CODE_ATTENDEE_TYPE_INVALID" });
    expect(mocks.promoCreate).not.toHaveBeenCalled();
  });

  it("rejects a newly chosen type that is inactive", async () => {
    mocks.typeFindMany.mockResolvedValueOnce([{ code: "teen", isActive: false }]);
    await expect(createPromoCode("event-1", { ...create, attendeeTypeCodes: ["teen"] } as never, "user-1"))
      .rejects.toBeInstanceOf(PromoCodeOperationError);
  });

  it("stores no restriction when none is chosen", async () => {
    await createPromoCode("event-1", create as never, "user-1");
    // Only the list's label lookup runs; no restriction is validated.
    expect(mocks.typeFindMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ code: expect.anything() }) }));
    expect(mocks.promoCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ attendeeTypeCodes: [] }) });
  });

  describe("on an edit", () => {
    const edit = { ...create, expectedUpdatedAt: "2027-01-01T12:00:00.000Z" };
    beforeEach(() => {
      mocks.promoFindFirst.mockResolvedValue(storedPromo({ attendeeTypeCodes: ["teen"] }));
      mocks.promoUpdateMany.mockResolvedValue({ count: 1 });
    });

    it("leaves the restriction as it is when the field is omitted", async () => {
      await updatePromoCode("event-1", "promo-1", edit as never, "user-1");
      expect(mocks.promoUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ attendeeTypeCodes: ["teen"] }) }));
    });

    it("clears it with an empty list", async () => {
      await updatePromoCode("event-1", "promo-1", { ...edit, attendeeTypeCodes: [] } as never, "user-1");
      expect(mocks.promoUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ attendeeTypeCodes: [] }) }));
    });

    it("keeps a listed type that has since been deactivated, but not a new inactive one", async () => {
      mocks.typeFindMany.mockResolvedValueOnce([{ code: "teen", isActive: false }]);
      await updatePromoCode("event-1", "promo-1", { ...edit, attendeeTypeCodes: ["teen"] } as never, "user-1");
      expect(mocks.promoUpdateMany).toHaveBeenCalled();
      mocks.promoUpdateMany.mockClear();
      mocks.typeFindMany.mockResolvedValueOnce([{ code: "teen", isActive: false }, { code: "child", isActive: false }]);
      await expect(updatePromoCode("event-1", "promo-1", { ...edit, attendeeTypeCodes: ["teen", "child"] } as never, "user-1"))
        .rejects.toMatchObject({ code: "PROMO_CODE_ATTENDEE_TYPE_INVALID" });
      expect(mocks.promoUpdateMany).not.toHaveBeenCalled();
    });

    it("refuses to combine a restriction with a church sponsor", async () => {
      mocks.promoFindFirst.mockResolvedValue(storedPromo({ attendeeTypeCodes: [], sponsoringOrganizationId: "church-1" }));
      await expect(updatePromoCode("event-1", "promo-1", { ...edit, attendeeTypeCodes: ["teen"] } as never, "user-1"))
        .rejects.toMatchObject({ code: "PROMO_CODE_ATTENDEE_TYPE_INVALID" });
    });
  });
});
