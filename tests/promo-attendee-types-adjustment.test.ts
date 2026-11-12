import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registrationFindFirst: vi.fn(),
  registrationUpdate: vi.fn(),
  adjustmentAggregate: vi.fn(),
  adjustmentFindMany: vi.fn(),
  adjustmentCreate: vi.fn(),
  promoFindUnique: vi.fn(),
  promoUpdateMany: vi.fn(),
  userFindUnique: vi.fn(),
}));

const tx = {
  registration: { findFirst: mocks.registrationFindFirst, update: mocks.registrationUpdate },
  registrationAdjustment: { aggregate: mocks.adjustmentAggregate, findMany: mocks.adjustmentFindMany, create: mocks.adjustmentCreate },
  promoCode: { findUnique: mocks.promoFindUnique, updateMany: mocks.promoUpdateMany, findMany: vi.fn().mockResolvedValue([]) },
  user: { findUnique: mocks.userFindUnique },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ $transaction: async (work: (client: typeof tx) => unknown) => work(tx) }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/registrations/repository", () => ({ getRegistrationById: vi.fn().mockResolvedValue({ id: "reg-1" }) }));

import { createRegistrationAdjustment } from "@/modules/registrations/adjustments";

const person = (id: string, first: string, typeCode: string | null) => ({
  id,
  profileSnapshot: { firstName: first, lastName: "Lee" },
  person: { firstName: first, lastName: "Lee" },
  attendeeTypeDefinition: typeCode ? { code: typeCode } : null,
});

function registration() {
  return {
    id: "reg-1",
    confirmationCode: "REG-1",
    status: "SUBMITTED",
    totalAmount: 205,
    submittedAt: new Date("2027-02-01T15:00:00Z"),
    createdAt: new Date("2027-02-01T15:00:00Z"),
    promoCodeRedemption: null,
    attendees: [person("att-1", "Ann", "adult"), person("att-2", "Teo", "teen"), person("att-3", "Sam", null)],
    publicFormSubmission: { pricingSnapshot: { lineItems: [
      { key: "fee-0", amountCents: 10_000, attendeeIndex: 0 },
      { key: "fee-1", amountCents: 8_000, attendeeIndex: 1 },
      { key: "fee-2", amountCents: 2_500, attendeeIndex: 2 },
    ] } },
    operations: [],
    payments: [],
    event: { billingMode: "PAY_AT_REGISTRATION" },
  };
}

const restricted = {
  id: "promo-1", code: "TEENS10", normalizedCode: "TEENS10", isActive: true, discountType: "PERCENT_BPS", discountValue: 1000,
  startsOn: null, endsOn: null, minimumSubtotalCents: null, maximumUses: null, maximumDiscountCents: null, redeemedCount: 0,
  sponsoringOrganizationId: null, attendeeTypeCodes: ["teen"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.registrationFindFirst.mockResolvedValue(registration());
  mocks.adjustmentAggregate.mockResolvedValue({ _sum: { amountCents: null } });
  mocks.adjustmentFindMany.mockResolvedValue([]);
  mocks.adjustmentCreate.mockResolvedValue({ id: "adj-1" });
  mocks.userFindUnique.mockResolvedValue({ displayName: "Finance Staff" });
  mocks.promoFindUnique.mockResolvedValue(restricted);
  mocks.promoUpdateMany.mockResolvedValue({ count: 1 });
});

describe("staff applying a restricted code after submission (#102)", () => {
  const apply = (attendeeId?: string) => createRegistrationAdjustment("event-1", "reg-1", "user-1", { kind: "PROMO_CODE", code: "teens10", reason: "Teen discount", ...(attendeeId ? { attendeeId } : {}) });

  it("applies to a person of the allowed type, on their own share", async () => {
    await apply("att-2");
    expect(mocks.adjustmentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ amountCents: -800, registrationAttendeeId: "att-2" }) });
  });

  it.each(["att-1", "att-3"])("refuses a person who is another type or has none (%s), taking no use", async (attendeeId) => {
    await expect(apply(attendeeId)).rejects.toMatchObject({ code: "PROMO_INVALID", message: "TEENS10 doesn't apply to this attendee type." });
    expect(mocks.promoUpdateMany).not.toHaveBeenCalled();
    expect(mocks.adjustmentCreate).not.toHaveBeenCalled();
  });

  it("refuses a restricted code on the whole registration", async () => {
    await expect(apply()).rejects.toMatchObject({ code: "PROMO_INVALID" });
    expect(mocks.adjustmentCreate).not.toHaveBeenCalled();
  });

  it("still applies an unrestricted code to anyone or the whole registration", async () => {
    mocks.promoFindUnique.mockResolvedValue({ ...restricted, attendeeTypeCodes: [] });
    await apply("att-1");
    expect(mocks.adjustmentCreate).toHaveBeenLastCalledWith({ data: expect.objectContaining({ amountCents: -1_000 }) });
    await apply();
    expect(mocks.adjustmentCreate).toHaveBeenCalledTimes(2);
  });
});
