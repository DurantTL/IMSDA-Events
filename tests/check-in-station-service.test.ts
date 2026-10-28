import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockPassError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  }
  class MockCheckInError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  }
  class MockPaymentError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  }
  return {
    MockPassError,
    MockCheckInError,
    MockPaymentError,
    getPrisma: vi.fn(),
    resolveAttendeePassForEvent: vi.fn(),
    checkInBlocksForAttendees: vi.fn(),
    checkInAttendee: vi.fn(),
    recordManualPayment: vi.fn(),
    writeAuditLog: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/background-checks/repository", () => ({ checkInBlocksForAttendees: mocks.checkInBlocksForAttendees }));
vi.mock("@/modules/checkin/attendee-pass-repository", () => ({
  AttendeePassResolutionError: mocks.MockPassError,
  registrationAttendeesSelect: {},
  resolveAttendeePassForEvent: mocks.resolveAttendeePassForEvent,
  serializeAttendee: (attendee: { id: string; first: string; last: string; type: string; checkedIn: boolean }) => ({
    id: attendee.id, firstName: attendee.first, lastName: attendee.last, attendeeType: attendee.type, checkedIn: attendee.checkedIn, checkedInAt: null,
  }),
}));
vi.mock("@/modules/checkin/club-pass-token", () => ({ clubPassTokenPrefix: "imsda-club-pass.v1" }));
vi.mock("@/modules/checkin/repository", () => ({
  CheckInOperationError: mocks.MockCheckInError,
  checkInAttendee: mocks.checkInAttendee,
}));
vi.mock("@/modules/payments/repository", () => ({
  PaymentOperationError: mocks.MockPaymentError,
  recordManualPayment: mocks.recordManualPayment,
}));

import {
  StationServiceError,
  checkInStationFamily,
  lookupStationFamily,
  noteStationSquareAppPayment,
  recordStationPayment,
} from "@/modules/checkin-stations/service";
import type { ResolvedStation } from "@/modules/checkin-stations/repository";

const station: ResolvedStation = {
  station: { id: "station_1", eventId: "event_1", label: "Front desk tablet", expiresAt: new Date("2026-11-01T18:00:00.000Z") },
  eventName: "Synthetic Camp Meeting",
  starter: { id: "user_1", displayName: "Casey Staff" },
  permissions: ["MANAGE_CHECK_IN", "MANAGE_FINANCE"],
  capabilities: { canCheckIn: true, canRecordPayments: true },
};
const keyA = "11111111-1111-4111-8111-111111111111";
const keyB = "22222222-2222-4222-8222-222222222222";

function registrationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "registration_1",
    confirmationCode: "CM27-ONE",
    totalAmount: 100,
    clubRegistration: null,
    attendees: [
      { id: "attendee_1", first: "Alex", last: "Example", type: "ADULT", checkedIn: false },
      { id: "attendee_2", first: "Blair", last: "Example", type: "CHILD", checkedIn: true },
      { id: "attendee_3", first: "Casey", last: "Example", type: "ADULT", checkedIn: false },
    ],
    event: { billingMode: "ATTENDEE_PAY" },
    payments: [{ amount: 40, refunds: [] }],
    ...overrides,
  };
}

function prismaFor(registration: Record<string, unknown> | null = registrationRow(), note: unknown = null) {
  const prisma = {
    registration: {
      findUnique: vi.fn().mockResolvedValue(registration),
      findFirst: vi.fn().mockResolvedValue(registration),
    },
    registrationAttendee: {
      // The registration's own people; anything else asked for is not on it.
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => ["attendee_1", "attendee_2", "attendee_3"].includes(id)).map((id) => ({ id }))),
    },
    auditLog: { findFirst: vi.fn().mockResolvedValue(note) },
    payment: { create: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
  };
  mocks.getPrisma.mockReturnValue(prisma);
  return prisma;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveAttendeePassForEvent.mockResolvedValue({ confirmationCode: "CM27-ONE" });
  mocks.checkInBlocksForAttendees.mockResolvedValue(new Map());
  mocks.checkInAttendee.mockResolvedValue({ checkedIn: true, disposition: "CREATED" });
});

describe("station family lookup (#892)", () => {
  it("shows only the scanned registration's names, with check-in state and its payment", async () => {
    prismaFor();
    const family = await lookupStationFamily(station, { kind: "confirmation", value: "cm27-one" });
    expect(mocks.resolveAttendeePassForEvent).toHaveBeenCalledWith("event_1", { kind: "confirmation", value: "cm27-one" });
    expect(family.attendees).toEqual([
      { id: "attendee_1", firstName: "Alex", lastName: "Example", attendeeType: "ADULT", checkedIn: false, needsDeskReview: false },
      { id: "attendee_2", firstName: "Blair", lastName: "Example", attendeeType: "CHILD", checkedIn: true, needsDeskReview: false },
      { id: "attendee_3", firstName: "Casey", lastName: "Example", attendeeType: "ADULT", checkedIn: false, needsDeskReview: false },
    ]);
    expect(family.payment).toEqual({ state: "DUE", balanceCents: 6000, squareAppNote: null });
    expect(JSON.stringify(family)).not.toMatch(/email|phone|health|sterling/i);
  });

  it("answers not found for a code or pass from another event", async () => {
    prismaFor();
    mocks.resolveAttendeePassForEvent.mockRejectedValue(new mocks.MockPassError("CONFIRMATION_NOT_FOUND", "No match"));
    await expect(lookupStationFamily(station, { kind: "confirmation", value: "OTHER-1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    mocks.resolveAttendeePassForEvent.mockRejectedValue(new mocks.MockPassError("PASS_UNAVAILABLE", "wrong event"));
    await expect(lookupStationFamily(station, { kind: "pass", value: "imsda-pass.v1.x.y.z" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("scopes the registration read to the station's event", async () => {
    const prisma = prismaFor(null);
    await expect(lookupStationFamily(station, { kind: "confirmation", value: "CM27-ONE" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(prisma.registration.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { eventId_confirmationCode: { eventId: "event_1", confirmationCode: "CM27-ONE" } },
    }));
  });

  it("sends an ineligible registration, a club registration and a club pass to the desk", async () => {
    prismaFor();
    mocks.resolveAttendeePassForEvent.mockRejectedValue(new mocks.MockPassError("REGISTRATION_NOT_ELIGIBLE", "no longer eligible"));
    await expect(lookupStationFamily(station, { kind: "confirmation", value: "CM27-ONE" })).rejects.toMatchObject({ code: "SEND_TO_DESK" });
    mocks.resolveAttendeePassForEvent.mockResolvedValue({ confirmationCode: "CM27-ONE" });
    prismaFor(registrationRow({ clubRegistration: { id: "club_1" } }));
    await expect(lookupStationFamily(station, { kind: "confirmation", value: "CM27-ONE" })).rejects.toMatchObject({ code: "SEND_TO_DESK" });
    await expect(lookupStationFamily(station, { kind: "pass", value: "imsda-club-pass.v1.a.b.c" })).rejects.toMatchObject({ code: "SEND_TO_DESK" });
  });

  it("flags a Sterling-held person only as needing desk review", async () => {
    prismaFor();
    mocks.checkInBlocksForAttendees.mockResolvedValue(new Map([["attendee_3", "EXPIRED"]]));
    const family = await lookupStationFamily(station, { kind: "confirmation", value: "CM27-ONE" });
    expect(family.attendees.find((person) => person.id === "attendee_3")?.needsDeskReview).toBe(true);
    expect(JSON.stringify(family)).not.toContain("EXPIRED");
  });

  it("shows Paid, church-billed, and a noted Square-app card payment", async () => {
    prismaFor(registrationRow({ payments: [{ amount: 100, refunds: [] }] }));
    expect((await lookupStationFamily(station, { kind: "confirmation", value: "CM27-ONE" })).payment).toEqual({ state: "PAID" });
    prismaFor(registrationRow({ event: { billingMode: "DEFERRED_ORGANIZATION_INVOICE" } }));
    expect((await lookupStationFamily(station, { kind: "confirmation", value: "CM27-ONE" })).payment).toEqual({ state: "BILLED_TO_GROUP" });
    prismaFor(registrationRow(), { createdAt: new Date("2026-10-31T15:00:00.000Z"), metadata: { amountCents: 6200 } });
    expect((await lookupStationFamily(station, { kind: "confirmation", value: "CM27-ONE" })).payment).toEqual({
      state: "DUE", balanceCents: 6000, squareAppNote: { amountCents: 6200, notedAt: "2026-10-31T15:00:00.000Z" },
    });
  });
});

describe("station check-in (#892)", () => {
  it("checks in only the ticked people, under the starter, with the station context and no override", async () => {
    prismaFor();
    const results = await checkInStationFamily(station, {
      registrationId: "registration_1",
      items: [{ attendeeId: "attendee_1", idempotencyKey: keyA }],
    });
    expect(results).toEqual([{ attendeeId: "attendee_1", status: "CHECKED_IN" }]);
    expect(mocks.checkInAttendee).toHaveBeenCalledTimes(1);
    expect(mocks.checkInAttendee).toHaveBeenCalledWith(
      "event_1", "attendee_1", "user_1", keyA,
      { auditContext: { station: { id: "station_1", label: "Front desk tablet" } } },
    );
  });

  it("rejects an attendee that is not on this registration in this event", async () => {
    const prisma = prismaFor();
    await expect(checkInStationFamily(station, {
      registrationId: "registration_1",
      items: [{ attendeeId: "attendee_1", idempotencyKey: keyA }, { attendeeId: "attendee_other_event", idempotencyKey: keyB }],
    })).rejects.toBeInstanceOf(StationServiceError);
    expect(prisma.registrationAttendee.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["attendee_1", "attendee_other_event"] }, eventId: "event_1", registrationId: "registration_1" },
    }));
    expect(mocks.checkInAttendee).not.toHaveBeenCalled();
  });

  it("reports a duplicate scan as already checked in", async () => {
    prismaFor();
    mocks.checkInAttendee.mockResolvedValue({ checkedIn: true, disposition: "ALREADY_CHECKED_IN" });
    const results = await checkInStationFamily(station, {
      registrationId: "registration_1",
      items: [{ attendeeId: "attendee_1", idempotencyKey: keyA }],
    });
    expect(results).toEqual([{ attendeeId: "attendee_1", status: "ALREADY_CHECKED_IN" }]);
  });

  it("replays a retried confirmation with the same key as the same result", async () => {
    prismaFor();
    mocks.checkInAttendee.mockResolvedValue({ checkedIn: true, disposition: "IDEMPOTENT_REPLAY" });
    const input = { registrationId: "registration_1", items: [{ attendeeId: "attendee_1", idempotencyKey: keyA }] };
    expect(await checkInStationFamily(station, input)).toEqual([{ attendeeId: "attendee_1", status: "CHECKED_IN" }]);
    expect(mocks.checkInAttendee.mock.calls[0][3]).toBe(keyA);
  });

  it("does not check in a Sterling-held person and reports desk review", async () => {
    prismaFor();
    mocks.checkInAttendee.mockRejectedValue(new mocks.MockCheckInError("STERLING_CHECK_NEEDED"));
    const results = await checkInStationFamily(station, {
      registrationId: "registration_1",
      items: [{ attendeeId: "attendee_3", idempotencyKey: keyA }],
    });
    expect(results).toEqual([{ attendeeId: "attendee_3", status: "NEEDS_DESK_REVIEW" }]);
    expect(mocks.checkInAttendee.mock.calls[0][4]).not.toHaveProperty("sterlingOverrideReason");
  });
});

describe("station payments (#892)", () => {
  it("records cash through the audited service with the station context", async () => {
    prismaFor();
    await recordStationPayment(station, { registrationId: "registration_1", method: "CASH", amountCents: 2500, checkNumber: "", idempotencyKey: keyA });
    expect(mocks.recordManualPayment).toHaveBeenCalledWith(
      "event_1", "registration_1", "user_1",
      { amountCents: 2500, method: "CASH", reference: "", idempotencyKey: keyA },
      { station: { id: "station_1", label: "Front desk tablet" } },
    );
  });

  it("stores the check number as the reference", async () => {
    prismaFor();
    await recordStationPayment(station, { registrationId: "registration_1", method: "CHECK", amountCents: 6000, checkNumber: "1042", idempotencyKey: keyA });
    expect(mocks.recordManualPayment.mock.calls[0][3]).toEqual({ amountCents: 6000, method: "CHECK", reference: "1042", idempotencyKey: keyA });
  });

  it("rejects an amount over the balance before recording anything", async () => {
    prismaFor();
    await expect(recordStationPayment(station, { registrationId: "registration_1", method: "CASH", amountCents: 6001, checkNumber: "", idempotencyKey: keyA }))
      .rejects.toMatchObject({ code: "PAYMENT_EXCEEDS_BALANCE" });
    expect(mocks.recordManualPayment).not.toHaveBeenCalled();
  });

  it("collects nothing for a church-billed or fully paid registration", async () => {
    prismaFor(registrationRow({ event: { billingMode: "DEFERRED_ORGANIZATION_INVOICE" } }));
    await expect(recordStationPayment(station, { registrationId: "registration_1", method: "CASH", amountCents: 100, checkNumber: "", idempotencyKey: keyA }))
      .rejects.toMatchObject({ code: "BILLED_TO_GROUP" });
    prismaFor(registrationRow({ payments: [{ amount: 100, refunds: [] }] }));
    await expect(recordStationPayment(station, { registrationId: "registration_1", method: "CASH", amountCents: 100, checkNumber: "", idempotencyKey: keyA }))
      .rejects.toMatchObject({ code: "NOTHING_DUE" });
    expect(mocks.recordManualPayment).not.toHaveBeenCalled();
  });

  it("replays a retry after a full payment instead of failing as nothing due", async () => {
    // The first save paid the whole balance; the retry carries the same key, amount and method.
    const prisma = prismaFor(registrationRow({ payments: [{ amount: 100, refunds: [] }] }));
    prisma.payment.findUnique = vi.fn().mockResolvedValue({ eventId: "event_1", registrationId: "registration_1", amount: 60, method: "CASH" });
    const summary = await recordStationPayment(station, { registrationId: "registration_1", method: "CASH", amountCents: 6000, checkNumber: "", idempotencyKey: keyA });
    expect(summary).toEqual({ state: "PAID" });
    expect(mocks.recordManualPayment).not.toHaveBeenCalled();
  });

  it("replays a retry after a partial payment even though the amount now exceeds the balance", async () => {
    // Total 100, 40 paid earlier plus this 40 saved: balance 20, and the retried 40 is over it.
    const prisma = prismaFor(registrationRow({ payments: [{ amount: 40, refunds: [] }, { amount: 40, refunds: [] }] }));
    prisma.payment.findUnique = vi.fn().mockResolvedValue({ eventId: "event_1", registrationId: "registration_1", amount: 40, method: "CHECK", externalReference: "1042" });
    const summary = await recordStationPayment(station, { registrationId: "registration_1", method: "CHECK", amountCents: 4000, checkNumber: "1042", idempotencyKey: keyA });
    expect(summary).toMatchObject({ state: "DUE", balanceCents: 2000 });
    expect(mocks.recordManualPayment).not.toHaveBeenCalled();
  });

  it("rejects a key that belongs to another registration, or to a different amount, method or check number", async () => {
    const prisma = prismaFor();
    for (const saved of [
      { eventId: "event_1", registrationId: "registration_other", amount: 25, method: "CASH" },
      { eventId: "event_1", registrationId: "registration_1", amount: 30, method: "CASH" },
      { eventId: "event_1", registrationId: "registration_1", amount: 25, method: "CHECK" },
      { eventId: "event_1", registrationId: "registration_1", amount: 25, method: "CASH", externalReference: "1042" },
    ]) {
      prisma.payment.findUnique = vi.fn().mockResolvedValue(saved);
      await expect(recordStationPayment(station, { registrationId: "registration_1", method: "CASH", amountCents: 2500, checkNumber: "", idempotencyKey: keyA }))
        .rejects.toMatchObject({ code: "PAYMENT_IDEMPOTENCY_KEY_REUSED" });
    }
    expect(mocks.recordManualPayment).not.toHaveBeenCalled();
  });

  it("scopes the registration to the station's event", async () => {
    const prisma = prismaFor(null);
    await expect(recordStationPayment(station, { registrationId: "registration_other_event", method: "CASH", amountCents: 100, checkNumber: "", idempotencyKey: keyA }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(prisma.registration.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "registration_other_event", eventId: "event_1" } }));
  });

  it("notes a Square-app card payment as an audit entry only, never a Payment row", async () => {
    const prisma = prismaFor();
    await noteStationSquareAppPayment(station, { registrationId: "registration_1", amountCents: 6000, receiptNumber: "R-1234" });
    expect(mocks.recordManualPayment).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "event_1",
      actorUserId: "user_1",
      action: "CHECK_IN_STATION_SQUARE_APP_NOTED",
      entityType: "Registration",
      entityId: "registration_1",
      metadata: {
        amountCents: 6000,
        receiptNumber: "R-1234",
        needsReconciliation: true,
        channel: "CHECK_IN_STATION",
        station: { id: "station_1", label: "Front desk tablet" },
      },
    }));
  });

  it("caps a Square-app note at the balance", async () => {
    prismaFor();
    await expect(noteStationSquareAppPayment(station, { registrationId: "registration_1", amountCents: 6001, receiptNumber: "" }))
      .rejects.toMatchObject({ code: "PAYMENT_EXCEEDS_BALANCE" });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("names the station in the Square-app note summary", async () => {
    prismaFor();
    await noteStationSquareAppPayment(station, { registrationId: "registration_1", amountCents: 6000, receiptNumber: "" });
    expect(mocks.writeAuditLog.mock.calls[0][0].summary).toContain('(check-in station "Front desk tablet")');
  });

  it("refuses a club registration for check-in, payment and Square notes, not only lookup", async () => {
    prismaFor(registrationRow({ clubRegistration: { id: "club_1" } }));
    await expect(checkInStationFamily(station, { registrationId: "registration_1", items: [{ attendeeId: "attendee_1", idempotencyKey: keyA }] }))
      .rejects.toMatchObject({ code: "SEND_TO_DESK" });
    await expect(recordStationPayment(station, { registrationId: "registration_1", method: "CASH", amountCents: 100, checkNumber: "", idempotencyKey: keyA }))
      .rejects.toMatchObject({ code: "SEND_TO_DESK" });
    await expect(noteStationSquareAppPayment(station, { registrationId: "registration_1", amountCents: 100, receiptNumber: "" }))
      .rejects.toMatchObject({ code: "SEND_TO_DESK" });
    expect(mocks.checkInAttendee).not.toHaveBeenCalled();
    expect(mocks.recordManualPayment).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("omits an empty receipt number from the note", async () => {
    prismaFor();
    await noteStationSquareAppPayment(station, { registrationId: "registration_1", amountCents: 6000, receiptNumber: "" });
    expect(mocks.writeAuditLog.mock.calls[0][0].metadata).not.toHaveProperty("receiptNumber");
  });
});
