import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  getRegistrationById: vi.fn(),
  invalidateHosted: vi.fn(),
  flushHosted: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/background-checks/repository", () => ({ checkInBlocksForAttendees: vi.fn().mockResolvedValue(new Map()) }));
vi.mock("@/modules/communications/transactional-messages", () => ({ enqueueRefundNoticeMessage: vi.fn() }));
vi.mock("@/modules/communications/messaging-repository", () => ({ processQueuedMessageIdsAfterCommit: vi.fn() }));
vi.mock("@/modules/registrations/repository", () => ({ getRegistrationById: mocks.getRegistrationById }));
vi.mock("@/modules/payments/square-hosted-invalidation", () => ({
  invalidateHostedCheckoutsInTransaction: mocks.invalidateHosted,
  flushHostedDeletionsAfterResponse: mocks.flushHosted,
}));

import { checkInAttendee } from "@/modules/checkin/repository";
import { recordManualPayment } from "@/modules/payments/repository";

const station = { station: { id: "station_1", label: "Front desk tablet" } };
const idempotencyKey = "d67776d0-f79d-4e8f-bec2-ee61abb7337c";

function checkInClient() {
  const tx = {
    checkIn: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "checkin_1" }) },
    registrationAttendee: {
      findFirst: vi.fn().mockResolvedValue({ id: "attendee_1", registration: { status: "CONFIRMED" }, checkIns: [] }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}), findFirst: vi.fn() },
  };
  mocks.getPrisma.mockReturnValue({ $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)) });
  return tx;
}

function paymentClient(existingPayment: { eventId: string; registrationId: string } | null = null) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    registration: { findFirst: vi.fn().mockResolvedValue({ status: "CONFIRMED", totalAmount: 100 }) },
    payment: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: "payment_new" }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    payment: { findUnique: vi.fn().mockResolvedValue(existingPayment) },
    registration: {
      findFirst: vi.fn().mockResolvedValue({
        id: "registration_1", eventId: "event_1", confirmationCode: "CM27-ONE", status: "CONFIRMED", totalAmount: 100, payments: [],
        publicFormSubmission: null,
      }),
    },
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation({ ...tx, payment: { ...tx.payment, findUnique: prisma.payment.findUnique } } as never)),
  };
  mocks.getPrisma.mockReturnValue(prisma);
  mocks.getRegistrationById.mockResolvedValue({ id: "registration_1" });
  return Object.assign(tx, { prisma });
}

beforeEach(() => vi.clearAllMocks());

describe("station audit context (#892)", () => {
  it("marks a station check-in under the starter's account", async () => {
    const tx = checkInClient();
    await checkInAttendee("event_1", "attendee_1", "user_1", idempotencyKey, { auditContext: station });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "user_1",
        action: "ATTENDEE_CHECKED_IN",
        summary: 'Checked in an attendee (check-in station "Front desk tablet").',
        metadata: { channel: "CHECK_IN_STATION", station: { id: "station_1", label: "Front desk tablet" } },
      }),
    });
  });

  it("leaves a desk check-in's audit entry exactly as it was", async () => {
    const tx = checkInClient();
    await checkInAttendee("event_1", "attendee_1", "user_1", idempotencyKey);
    const data = tx.auditLog.create.mock.calls[0][0].data;
    expect(data.summary).toBe("Checked in an attendee.");
    expect(data).not.toHaveProperty("metadata");
  });

  it("marks a station cash payment with the station and keeps the amount", async () => {
    const tx = paymentClient();
    await recordManualPayment("event_1", "registration_1", "user_1", { amountCents: 2500, method: "CASH", reference: "" }, station);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "user_1",
        action: "MANUAL_PAYMENT_RECORDED",
        summary: 'Recorded a cash payment on registration CM27-ONE (check-in station "Front desk tablet").',
        metadata: { amountCents: 2500, channel: "CHECK_IN_STATION", station: { id: "station_1", label: "Front desk tablet" } },
      }),
    });
  });

  it("leaves a desk payment's audit entry exactly as it was", async () => {
    const tx = paymentClient();
    await recordManualPayment("event_1", "registration_1", "user_1", { amountCents: 2500, method: "CHECK", reference: "1042" });
    const data = tx.auditLog.create.mock.calls[0][0].data;
    expect(data.summary).toBe("Recorded a check payment on registration CM27-ONE.");
    expect(data.metadata).toEqual({ amountCents: 2500 });
  });

  it("saves a keyed payment once and replays a retry without a second row or audit entry", async () => {
    const first = paymentClient();
    await recordManualPayment("event_1", "registration_1", "user_1", { amountCents: 10_000, method: "CASH", reference: "", idempotencyKey: idempotencyKey }, station);
    expect(first.payment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ idempotencyKey }) });
    expect(first.auditLog.create).toHaveBeenCalledTimes(1);

    // The retry: the key now exists for this registration, and the full balance was already used up.
    const retry = paymentClient({ eventId: "event_1", registrationId: "registration_1" });
    await recordManualPayment("event_1", "registration_1", "user_1", { amountCents: 10_000, method: "CASH", reference: "", idempotencyKey }, station);
    expect(retry.payment.create).not.toHaveBeenCalled();
    expect(retry.auditLog.create).not.toHaveBeenCalled();
    expect(mocks.getRegistrationById).toHaveBeenCalledWith("event_1", "registration_1");
  });

  it("rejects a key already used for another registration", async () => {
    const tx = paymentClient({ eventId: "event_1", registrationId: "registration_other" });
    await expect(recordManualPayment("event_1", "registration_1", "user_1", { amountCents: 100, method: "CASH", reference: "", idempotencyKey }, station))
      .rejects.toMatchObject({ code: "PAYMENT_IDEMPOTENCY_KEY_REUSED" });
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it("records an unkeyed (finance desk) payment with a null key and never looks one up", async () => {
    const tx = paymentClient();
    await recordManualPayment("event_1", "registration_1", "user_1", { amountCents: 2500, method: "CHECK", reference: "1042" });
    expect(tx.payment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ idempotencyKey: null }) });
    expect(tx.prisma.payment.findUnique).not.toHaveBeenCalled();
  });
});
