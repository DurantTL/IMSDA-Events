import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Staff price override for one person (#1509 part 2). The database is mocked; the rules live in
 * modules/registrations/adjustments.ts and the ledger's own sign rule (modules/ledger/domain.ts) runs for real.
 * Synthetic data only.
 */
const mocks = vi.hoisted(() => ({
  registrationFindFirst: vi.fn(),
  registrationUpdate: vi.fn(),
  adjustmentAggregate: vi.fn(),
  adjustmentFindFirst: vi.fn(),
  adjustmentFindMany: vi.fn(),
  adjustmentCreate: vi.fn(),
  ledgerCreate: vi.fn(),
  userFindUnique: vi.fn(),
  writeAuditLog: vi.fn(),
  getRegistrationById: vi.fn(),
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
}));

const tx = {
  registration: { findFirst: mocks.registrationFindFirst, update: mocks.registrationUpdate },
  registrationAdjustment: { aggregate: mocks.adjustmentAggregate, findFirst: mocks.adjustmentFindFirst, findMany: mocks.adjustmentFindMany, create: mocks.adjustmentCreate },
  registrationLedgerEntry: { create: mocks.ledgerCreate },
  promoCode: { updateMany: vi.fn(), findMany: vi.fn() },
  user: { findUnique: mocks.userFindUnique },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ $transaction: async (work: (client: typeof tx) => unknown) => work(tx) }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/registrations/repository", () => ({ getRegistrationById: mocks.getRegistrationById }));
vi.mock("@/modules/promo-codes/repository", () => ({ claimPromoCode: vi.fn(), PublicPromoCodeError: class extends Error {}, PromoCodeOperationError: class extends Error {} }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));

import { createAdjustmentSchema, createRegistrationAdjustment, reverseRegistrationAdjustment } from "@/modules/registrations/adjustments";
import { POST } from "@/app/api/events/[eventId]/registrations/[registrationId]/adjustments/route";

function registration(overrides: Record<string, unknown> = {}) {
  return {
    id: "reg-1",
    confirmationCode: "REG-1",
    status: "SUBMITTED",
    totalAmount: 270,
    submittedAt: new Date("2026-06-01T15:00:00Z"),
    createdAt: new Date("2026-06-01T15:00:00Z"),
    promoCodeRedemption: null,
    attendees: [
      { id: "att-1", profileSnapshot: { firstName: "Ann", lastName: "Lee" }, person: { firstName: "Ann", lastName: "Lee" } },
      { id: "att-2", profileSnapshot: { firstName: "Sara", lastName: "Lee" }, person: { firstName: "Sara", lastName: "Lee" } },
    ],
    publicFormSubmission: { pricingSnapshot: { lineItems: [
      { key: "fee-0", amountCents: 14500, attendeeIndex: 0 },
      { key: "fee-1", amountCents: 12500, attendeeIndex: 1 },
    ] } },
    operations: [],
    payments: [],
    ...overrides,
  };
}

const override = (priceCents: number, extra: Record<string, unknown> = {}) => createAdjustmentSchema.parse({ kind: "PRICE_OVERRIDE", attendeeId: "att-2", priceCents, reason: "Approved by the committee", ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.registrationFindFirst.mockResolvedValue(registration());
  mocks.adjustmentAggregate.mockResolvedValue({ _sum: { amountCents: null } });
  mocks.adjustmentFindFirst.mockResolvedValue(null);
  mocks.adjustmentFindMany.mockResolvedValue([]);
  mocks.adjustmentCreate.mockResolvedValue({ id: "adj-1" });
  mocks.ledgerCreate.mockResolvedValue({});
  mocks.userFindUnique.mockResolvedValue({ displayName: "Finance Staff" });
  mocks.getRegistrationById.mockResolvedValue({ id: "reg-1" });
});

describe("price override input", () => {
  it("needs a person, a whole-cent price of $0 or more and a reason", () => {
    expect(createAdjustmentSchema.safeParse({ kind: "PRICE_OVERRIDE", priceCents: 1000, reason: "Approved" }).success).toBe(false);
    expect(createAdjustmentSchema.safeParse({ kind: "PRICE_OVERRIDE", attendeeId: "att-2", priceCents: -1, reason: "Approved" }).success).toBe(false);
    expect(createAdjustmentSchema.safeParse({ kind: "PRICE_OVERRIDE", attendeeId: "att-2", priceCents: 10.5, reason: "Approved" }).success).toBe(false);
    expect(createAdjustmentSchema.safeParse({ kind: "PRICE_OVERRIDE", attendeeId: "att-2", priceCents: 1000, reason: "no" }).success).toBe(false);
    expect(createAdjustmentSchema.safeParse({ kind: "PRICE_OVERRIDE", attendeeId: "att-2", priceCents: 0, reason: "Free for staff" }).success).toBe(true);
  });
});

describe("setting one person's price", () => {
  it("lowers the person's price: a negative line, a lower total, a DISCOUNT ledger entry and an audit without names", async () => {
    await createRegistrationAdjustment("event-1", "reg-1", "user-1", override(10000));
    expect(mocks.adjustmentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "PRICE_OVERRIDE", amountCents: -2500, registrationAttendeeId: "att-2", reason: "Approved by the committee" }) });
    expect(mocks.registrationUpdate).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { totalAmount: 245 } });
    expect(mocks.ledgerCreate).toHaveBeenCalledTimes(1);
    expect(mocks.ledgerCreate.mock.calls[0]![0].data).toMatchObject({
      kind: "DISCOUNT", amountCents: -2500, sourceType: "STAFF_PRICE_OVERRIDE", sourceId: "adj-1", origin: "LIVE", actorType: "STAFF", actorId: "user-1", reason: "Approved by the committee",
      pricingSnapshot: { attendeeIndex: 1, previousPriceCents: 12500, newPriceCents: 10000, changeCents: -2500 },
    });
    const audit = mocks.writeAuditLog.mock.calls.find(([entry]) => entry.action === "REGISTRATION_PRICE_OVERRIDDEN")![0];
    expect(audit).toMatchObject({
      entityId: "adj-1",
      metadata: { registrationId: "reg-1", adjustmentId: "adj-1", registrationAttendeeId: "att-2", personPriceBeforeCents: 12500, personPriceAfterCents: 10000, totalBeforeCents: 27000, totalAfterCents: 24500 },
    });
    expect(JSON.stringify(audit)).not.toMatch(/Sara|Lee/);
  });

  it("raises the person's price: a positive line and a CHARGE ledger entry", async () => {
    await createRegistrationAdjustment("event-1", "reg-1", "user-1", override(15000));
    expect(mocks.adjustmentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "PRICE_OVERRIDE", amountCents: 2500 }) });
    expect(mocks.registrationUpdate).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { totalAmount: 295 } });
    expect(mocks.ledgerCreate.mock.calls[0]![0].data).toMatchObject({ kind: "CHARGE", amountCents: 2500, sourceType: "STAFF_PRICE_OVERRIDE" });
  });

  it("starts from the person's share with their earlier adjustments, so a second override is judged against the first", async () => {
    mocks.adjustmentAggregate.mockResolvedValue({ _sum: { amountCents: -2500 } });
    await expect(createRegistrationAdjustment("event-1", "reg-1", "user-1", override(10000)))
      .rejects.toMatchObject({ code: "PRICE_OVERRIDE_UNCHANGED" });
    await createRegistrationAdjustment("event-1", "reg-1", "user-1", override(8000));
    expect(mocks.adjustmentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ amountCents: -2000 }) });
  });

  it("can set the price to $0", async () => {
    await createRegistrationAdjustment("event-1", "reg-1", "user-1", override(0));
    expect(mocks.adjustmentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ amountCents: -12500 }) });
    expect(mocks.ledgerCreate.mock.calls[0]![0].data).toMatchObject({ kind: "DISCOUNT", amountCents: -12500 });
  });

  it("refuses the price the person already pays, in plain words, and writes nothing", async () => {
    await expect(createRegistrationAdjustment("event-1", "reg-1", "user-1", override(12500)))
      .rejects.toMatchObject({ code: "PRICE_OVERRIDE_UNCHANGED", message: expect.stringContaining("already pays $125.00") });
    expect(mocks.adjustmentCreate).not.toHaveBeenCalled();
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses when the registration has no per-person price, or the person isn't on it", async () => {
    mocks.registrationFindFirst.mockResolvedValue(registration({ publicFormSubmission: null }));
    await expect(createRegistrationAdjustment("event-1", "reg-1", "user-1", override(1000))).rejects.toMatchObject({ code: "ATTENDEE_PRICE_UNKNOWN" });
    mocks.registrationFindFirst.mockResolvedValue(registration());
    await expect(createRegistrationAdjustment("event-1", "reg-1", "user-1", override(1000, { attendeeId: "nobody" }))).rejects.toMatchObject({ code: "ATTENDEE_NOT_FOUND" });
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
  });

  it("refuses a change that takes the total below what has been paid", async () => {
    mocks.registrationFindFirst.mockResolvedValue(registration({ payments: [{ amount: 270, refunds: [] }] }));
    await expect(createRegistrationAdjustment("event-1", "reg-1", "user-1", override(10000))).rejects.toMatchObject({ code: "TOTAL_BELOW_PAID" });
    expect(mocks.adjustmentCreate).not.toHaveBeenCalled();
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
  });

  it("refuses a change that takes the total below $0", async () => {
    mocks.registrationFindFirst.mockResolvedValue(registration({ totalAmount: 100 }));
    await expect(createRegistrationAdjustment("event-1", "reg-1", "user-1", override(0))).rejects.toMatchObject({ code: "TOTAL_BELOW_ZERO" });
  });

  it("refuses a registration that is not submitted or confirmed", async () => {
    mocks.registrationFindFirst.mockResolvedValue(registration({ status: "CANCELLED" }));
    await expect(createRegistrationAdjustment("event-1", "reg-1", "user-1", override(10000))).rejects.toMatchObject({ code: "REGISTRATION_NOT_ADJUSTABLE" });
  });
});

describe("reversing a price override", () => {
  const line = (overrides: Record<string, unknown> = {}) => ({
    id: "adj-1", kind: "PRICE_OVERRIDE", amountCents: -2500, promoCodeId: null, promoCodeSnapshot: null, registrationAttendeeId: "att-2",
    reversesAdjustmentId: null, reversedBy: null, scholarshipAward: null, ...overrides,
  });

  it("adds the opposite line and its own ledger entry keyed to the reversal", async () => {
    mocks.registrationFindFirst.mockResolvedValue(registration({ totalAmount: 245 }));
    mocks.adjustmentFindFirst.mockResolvedValue(line());
    mocks.adjustmentAggregate.mockResolvedValue({ _sum: { amountCents: -2500 } });
    mocks.adjustmentCreate.mockResolvedValue({ id: "adj-2" });
    await reverseRegistrationAdjustment("event-1", "reg-1", "adj-1", "user-1", "Committee changed its mind");
    expect(mocks.adjustmentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "PRICE_OVERRIDE", amountCents: 2500, reversesAdjustmentId: "adj-1", registrationAttendeeId: "att-2" }) });
    expect(mocks.registrationUpdate).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { totalAmount: 270 } });
    expect(mocks.ledgerCreate).toHaveBeenCalledTimes(1);
    expect(mocks.ledgerCreate.mock.calls[0]![0].data).toMatchObject({
      kind: "CHARGE", amountCents: 2500, sourceType: "STAFF_PRICE_OVERRIDE", sourceId: "adj-2", reason: "Committee changed its mind",
      pricingSnapshot: { attendeeIndex: 1, previousPriceCents: 10000, newPriceCents: 12500, changeCents: 2500 },
    });
  });

  it("reversing a raise writes a DISCOUNT entry", async () => {
    mocks.registrationFindFirst.mockResolvedValue(registration({ totalAmount: 295 }));
    mocks.adjustmentFindFirst.mockResolvedValue(line({ amountCents: 2500 }));
    mocks.adjustmentAggregate.mockResolvedValue({ _sum: { amountCents: 2500 } });
    mocks.adjustmentCreate.mockResolvedValue({ id: "adj-2" });
    await reverseRegistrationAdjustment("event-1", "reg-1", "adj-1", "user-1", "Entered by mistake");
    expect(mocks.ledgerCreate.mock.calls[0]![0].data).toMatchObject({ kind: "DISCOUNT", amountCents: -2500, sourceId: "adj-2" });
  });

  it("another kind of adjustment writes no ledger entry when reversed", async () => {
    mocks.registrationFindFirst.mockResolvedValue(registration({ totalAmount: 245 }));
    mocks.adjustmentFindFirst.mockResolvedValue(line({ kind: "DISCOUNT" }));
    await reverseRegistrationAdjustment("event-1", "reg-1", "adj-1", "user-1", "Entered by mistake");
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
  });
});

describe("POST adjustments route for a price override", () => {
  const context = { params: Promise.resolve({ eventId: "event-1", registrationId: "reg-1" }) };
  const request = () => new Request("https://events.imsda.test/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://events.imsda.test" },
    body: JSON.stringify({ kind: "PRICE_OVERRIDE", attendeeId: "att-2", priceCents: 10000, reason: "Approved by the committee" }),
  });
  const user = { id: "user-1", globalRole: null, email: "staff@example.test", displayName: "Staff" };

  beforeEach(() => {
    mocks.getCurrentSession.mockResolvedValue({ user });
  });

  it("refuses a member without MANAGE_FINANCE with 403 before touching the registration", async () => {
    mocks.findActiveMembership.mockResolvedValue({ eventId: "event-1", userId: "user-1", role: "READ_ONLY_STAFF", status: "ACTIVE", permissions: [] });
    const response = await POST(request(), context);
    expect(response.status).toBe(403);
    expect(mocks.registrationFindFirst).not.toHaveBeenCalled();
    expect(mocks.adjustmentCreate).not.toHaveBeenCalled();
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
  });

  it("lets a finance manager set the price", async () => {
    mocks.findActiveMembership.mockResolvedValue({ eventId: "event-1", userId: "user-1", role: "FINANCE_MANAGER", status: "ACTIVE", permissions: [] });
    const response = await POST(request(), context);
    expect(response.status).toBe(201);
    expect(mocks.ledgerCreate).toHaveBeenCalledTimes(1);
  });

  it("answers a repeat of the same price with a plain 409", async () => {
    mocks.findActiveMembership.mockResolvedValue({ eventId: "event-1", userId: "user-1", role: "FINANCE_MANAGER", status: "ACTIVE", permissions: [] });
    mocks.registrationFindFirst.mockResolvedValue(registration({ totalAmount: 245 }));
    mocks.adjustmentAggregate.mockResolvedValue({ _sum: { amountCents: -2500 } });
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "PRICE_OVERRIDE_UNCHANGED" });
  });
});
