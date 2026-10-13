import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  authorizeRegistrationAccessToken: vi.fn(),
  enqueuePaymentReceiptMessage: vi.fn(),
  enqueueRefundNoticeMessage: vi.fn(),
  processQueuedMessageIdsAfterCommit: vi.fn(),
  getRegistrationById: vi.fn(),
  invalidateHosted: vi.fn(),
  flushHosted: vi.fn(),
  dispatchAlerts: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/public-access/repository", () => ({
  authorizeRegistrationAccessToken: mocks.authorizeRegistrationAccessToken,
}));
vi.mock("@/modules/communications/transactional-messages", () => ({
  enqueuePaymentReceiptMessage: mocks.enqueuePaymentReceiptMessage,
  enqueueRefundNoticeMessage: mocks.enqueueRefundNoticeMessage,
}));
vi.mock("@/modules/communications/messaging-repository", () => ({
  processQueuedMessageIdsAfterCommit: mocks.processQueuedMessageIdsAfterCommit,
}));
vi.mock("@/modules/operations/alerting", () => ({ dispatchAlerts: mocks.dispatchAlerts }));
vi.mock("@/modules/registrations/repository", () => ({
  getRegistrationById: mocks.getRegistrationById,
}));
vi.mock("@/modules/payments/square-hosted-invalidation", () => ({
  invalidateHostedCheckoutsInTransaction: mocks.invalidateHosted,
  flushHostedDeletionsAfterResponse: mocks.flushHosted,
}));

import { Prisma } from "@prisma/client";
import type { SquareRuntimeConfiguration } from "@/modules/payments/square-config";
import { recordManualPayment } from "@/modules/payments/repository";
import {
  createPublicSquarePayment,
  getPublicSquareCheckout,
} from "@/modules/payments/square-repository";
import { createPublicSquarePaymentLink } from "@/modules/payments/square-hosted-repository";

const configuration: SquareRuntimeConfiguration = {
  environment: "sandbox",
  applicationId: "sandbox-sq0idb-example",
  locationId: "sandbox-location",
  accessToken: "sandbox-access-token",
  apiUrl: "https://connect.squareupsandbox.com",
  apiVersion: "2026-07-15",
  scriptUrl: "https://sandbox.web.squarecdn.com/v1/square.js",
  webhookSignatureKey: "sandbox-signature-key",
  webhookNotificationUrl: "https://events.imsda.test/api/webhooks/square",
  paymentConfigured: true,
  webhookConfigured: true,
  issue: null,
};

const depositOption = "Pay a $65 deposit now by card";
const formDefinition = {
  title: "Deposit repository test",
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
    deposit: { enabled: true, amountCents: 6500, optionValue: depositOption },
  },
  sections: [{
    id: "payment-section",
    title: "Payment",
    description: "",
    fields: [{
      id: "payment-method",
      key: "payment_method",
      label: "Payment method",
      helpText: "",
      type: "RADIO",
      scope: "REGISTRATION",
      required: true,
      options: ["Pay later", depositOption, "Credit / debit card"],
    }],
  }],
};

type PaymentRow = { amount: number; isDeposit?: boolean; refunds: Array<{ amount: number }> };

function registration(over: {
  method?: string;
  payments?: PaymentRow[];
  totalAmount?: number;
  definition?: unknown;
} = {}) {
  return {
    id: "registration-1",
    eventId: "event-1",
    confirmationCode: "CM27-ONE",
    status: "SUBMITTED",
    totalAmount: over.totalAmount ?? 300,
    event: { billingMode: "ATTENDEE_PAY", hostedPaymentLinkEnabled: true },
    contactSnapshot: { firstName: "Test", lastName: "Registrant", email: "test.registrant@example.test", phone: "" },
    accountHolderPerson: { firstName: "Test", lastName: "Registrant", normalizedEmail: "test.registrant@example.test", phone: null },
    payments: over.payments ?? [],
    paymentAttempts: [],
    waitlistEntry: null,
    paymentChoiceOperations: [],
    publicFormSubmission: {
      responses: { payment_method: over.method ?? depositOption },
      pricingSnapshot: { currency: "USD", subtotalCents: 30_000 },
      formVersion: {
        status: "PUBLISHED",
        definition: over.definition ?? formDefinition,
        form: { versions: [{ id: "live-version" }] },
      },
    },
  };
}

function attemptFor(over: Record<string, unknown> = {}) {
  return {
    id: "attempt-1",
    eventId: "event-1",
    registrationId: "registration-1",
    registrationAccessTokenId: "access-1",
    paymentId: null,
    provider: "SQUARE",
    environment: "sandbox",
    channel: "EMBEDDED",
    clientIdempotencyKey: "d67776d0-f79d-4e8f-bec2-ee61abb7337c",
    providerIdempotencyKey: "imsda_stable_provider_key",
    activeRegistrationKey: "registration-1",
    isDeposit: true,
    amountCents: 6726,
    surchargeCents: 226,
    currency: "USD",
    status: "PROCESSING",
    providerPaymentId: null,
    providerStatus: null,
    providerStatusAt: null,
    failureCode: null,
    failureMessage: null,
    requestCount: 1,
    lastRequestedAt: new Date("2027-03-30T13:00:00.000Z"),
    completedAt: null,
    createdAt: new Date("2027-03-30T13:00:00.000Z"),
    updatedAt: new Date("2027-03-30T13:00:00.000Z"),
    payment: null,
    registration: { confirmationCode: "CM27-ONE" },
    ...over,
  };
}

function transactionClient(loaded = registration()) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    registration: {
      findUnique: vi.fn().mockResolvedValue(loaded),
      update: vi.fn().mockResolvedValue({ totalAmount: 302.26 }),
    },
    paymentAttempt: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
    },
    payment: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    squareHostedCheckout: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    squareDuplicateCharge: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
}

function prismaFor(tx: ReturnType<typeof transactionClient>) {
  return {
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
  };
}

const token = "a".repeat(43);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorizeRegistrationAccessToken.mockResolvedValue({
    accessTokenId: "access-1",
    registrationId: "registration-1",
    eventId: "event-1",
    registrationStatus: "SUBMITTED",
  });
  mocks.enqueuePaymentReceiptMessage.mockResolvedValue({
    messageIds: [],
    pendingMessageIds: [],
    deliveryMode: "LOCAL_CAPTURE",
    skippedReason: null,
  });
  mocks.processQueuedMessageIdsAfterCommit.mockResolvedValue({
    capturedIds: [], sentIds: [], failedIds: [], rescheduledIds: [], skippedIds: [],
  });
  mocks.invalidateHosted.mockResolvedValue(0);
  mocks.flushHosted.mockResolvedValue(undefined);
});

describe("card deposit checkout (#415)", () => {
  it("quotes the deposit with the card fee on the deposit only when the registrant chose it", async () => {
    const client = transactionClient();
    const checkout = await getPublicSquareCheckout(token, { client: client as never, configuration });
    expect(checkout).toMatchObject({
      state: "READY",
      paymentKind: "DEPOSIT",
      amountCents: 6726,
      surchargeCents: 226,
      balanceCents: 30_000,
      depositRecorded: false,
      deposit: { depositCents: 6500, surchargeCents: 226, chargeCents: 6726, balanceAfterCents: 23_500, chosenOnForm: true },
    });
  });

  it("offers a pay-later registrant the deposit beside the balance, which stays the default", async () => {
    const client = transactionClient(registration({ method: "Pay later" }));
    const balance = await getPublicSquareCheckout(token, { client: client as never, configuration });
    expect(balance).toMatchObject({
      paymentKind: "BALANCE",
      balanceCents: 30_000,
      surchargeCents: 927, // ceil(30030 / 0.971) - 30000: the pay-later fee on the whole balance
      deposit: { chargeCents: 6726, chosenOnForm: false },
    });
    const deposit = await getPublicSquareCheckout(token, { client: client as never, configuration, kind: "DEPOSIT" });
    expect(deposit).toMatchObject({ paymentKind: "DEPOSIT", amountCents: 6726, surchargeCents: 226 });
  });

  it("falls back to the balance quote once a deposit is recorded, with the fee on the balance only", async () => {
    // Deposit paid by card: 67.26 received, 2.26 fee already added to the total.
    const client = transactionClient(registration({
      totalAmount: 302.26,
      payments: [{ amount: 67.26, isDeposit: true, refunds: [] }],
    }));
    const checkout = await getPublicSquareCheckout(token, { client: client as never, configuration });
    expect(checkout).toMatchObject({
      paymentKind: "BALANCE",
      balanceCents: 23_500,
      deposit: null,
      depositRecorded: true,
    });
    // Pay-later arithmetic on the remaining balance: 2.9% + 30c grossed up on $235.00.
    expect(checkout).toMatchObject({ surchargeCents: 733, amountCents: 23_500 + 733 });
  });

  it("never offers a deposit to a registration that chose to pay the whole amount by card", async () => {
    const client = transactionClient(registration({ method: "Credit / debit card" }));
    const checkout = await getPublicSquareCheckout(token, { client: client as never, configuration });
    expect(checkout).toMatchObject({ paymentKind: "BALANCE", deposit: null, surchargeCents: 0, amountCents: 30_000 });
  });

  it("charges a stored deposit amount and marks the attempt and payment as the deposit", async () => {
    const tx = transactionClient(registration({ method: "Pay later" }));
    const attempt = attemptFor();
    const succeeded = {
      ...attempt,
      paymentId: "payment-1",
      activeRegistrationKey: null,
      status: "SUCCEEDED",
      providerPaymentId: "square-payment-1",
      providerStatus: "COMPLETED",
      payment: { id: "payment-1", amount: 67.26, isDeposit: true, status: "SUCCEEDED", method: "CARD_REFERENCE", receivedAt: new Date() },
    };
    tx.paymentAttempt.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(attempt);
    tx.paymentAttempt.create.mockResolvedValue(attempt);
    tx.paymentAttempt.update.mockResolvedValue(succeeded);
    tx.payment.create.mockResolvedValue(succeeded.payment);
    mocks.getPrisma.mockReturnValue(prismaFor(tx));
    const createPayment = vi.fn().mockResolvedValue({
      id: "square-payment-1",
      status: "COMPLETED",
      amountCents: 6726,
      currency: "USD",
      createdAt: "2027-03-30T13:00:00.000Z",
      updatedAt: "2027-03-30T13:00:01.000Z",
    });

    await createPublicSquarePayment(
      token,
      { sourceId: "cnon:card-nonce-ok", idempotencyKey: attempt.clientIdempotencyKey, kind: "DEPOSIT" },
      { configuration, createPayment, now: new Date("2027-03-30T13:00:01.000Z") },
    );

    expect(tx.paymentAttempt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isDeposit: true, amountCents: 6726, surchargeCents: 226 }),
    }));
    expect(createPayment).toHaveBeenCalledWith(configuration, expect.objectContaining({ amountCents: 6726 }));
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isDeposit: true, amount: 67.26 }),
    }));
    // Only the fee on the deposit joins the total, so the balance left is subtotal minus the deposit.
    expect(tx.registration.update).toHaveBeenCalledWith({
      where: { id: "registration-1" },
      data: { totalAmount: { increment: 2.26 } },
      select: { totalAmount: true },
    });
  });

  it("replays a repeated submission without a second charge or attempt", async () => {
    const tx = transactionClient(registration({ method: "Pay later" }));
    const existing = attemptFor({
      activeRegistrationKey: null,
      status: "SUCCEEDED",
      providerPaymentId: "square-payment-1",
    });
    tx.paymentAttempt.findUnique.mockResolvedValue(existing);
    mocks.getPrisma.mockReturnValue(prismaFor(tx));
    const createPayment = vi.fn();

    const result = await createPublicSquarePayment(
      token,
      { sourceId: "cnon:irrelevant", idempotencyKey: existing.clientIdempotencyKey, kind: "DEPOSIT" },
      { configuration, createPayment },
    );

    expect(result.status).toBe("SUCCEEDED");
    expect(createPayment).not.toHaveBeenCalled();
    expect(tx.paymentAttempt.create).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it("refuses a deposit that is no longer on offer instead of charging the whole balance", async () => {
    const tx = transactionClient(registration({
      method: "Pay later",
      totalAmount: 302.26,
      payments: [{ amount: 67.26, isDeposit: true, refunds: [] }],
    }));
    tx.paymentAttempt.findUnique.mockResolvedValue(null);
    mocks.getPrisma.mockReturnValue(prismaFor(tx));
    const createPayment = vi.fn();

    await expect(createPublicSquarePayment(
      token,
      { sourceId: "cnon:card-nonce-ok", idempotencyKey: "0f0e0d0c-0b0a-4908-8706-050403020100", kind: "DEPOSIT" },
      { configuration, createPayment },
    )).rejects.toMatchObject({ code: "DEPOSIT_UNAVAILABLE" });
    expect(createPayment).not.toHaveBeenCalled();
    expect(tx.paymentAttempt.create).not.toHaveBeenCalled();
  });
});

function staffClient(options: { payments?: PaymentRow[]; locked?: PaymentRow[]; lockedTotal?: number; definition?: unknown } = {}) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    registration: {
      findFirst: vi.fn().mockResolvedValue({ status: "SUBMITTED", totalAmount: options.lockedTotal ?? 300 }),
    },
    payment: {
      findMany: vi.fn().mockResolvedValue(options.locked ?? options.payments ?? []),
      create: vi.fn().mockResolvedValue({ id: "payment-new" }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    registration: {
      findFirst: vi.fn().mockResolvedValue({
        id: "registration-1",
        eventId: "event-1",
        confirmationCode: "CM27-ONE",
        status: "SUBMITTED",
        totalAmount: 300,
        payments: options.payments ?? [],
        publicFormSubmission: { formVersion: { definition: options.definition ?? formDefinition } },
      }),
    },
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
  };
  mocks.getPrisma.mockReturnValue(prisma);
  mocks.getRegistrationById.mockResolvedValue({ id: "registration-1" });
  return { tx, prisma };
}

describe("staff-recorded check deposit (#415)", () => {
  it("records the mailed check as the deposit, audited, and leaves the rest as the balance", async () => {
    const { tx } = staffClient();
    await recordManualPayment("event-1", "registration-1", "user-1", {
      amountCents: 6500, method: "CHECK", reference: "TEST-1001", isDeposit: true,
    });
    expect(tx.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: 65, isDeposit: true, method: "CHECK", status: "SUCCEEDED" }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "RESERVATION_DEPOSIT_RECORDED",
        actorUserId: "user-1",
        entityType: "Payment",
        entityId: "payment-new",
        metadata: expect.objectContaining({ amountCents: 6500, balanceBeforeCents: 30_000, balanceAfterCents: 23_500, reservationHeld: true }),
      }),
    });
    expect(mocks.invalidateHosted).toHaveBeenCalled();
  });

  it("runs SERIALIZABLE and, when PostgreSQL rolls it back, re-checks everything and audits once", async () => {
    const { tx, prisma } = staffClient();
    let attempts = 0;
    prisma.$transaction = vi.fn(async (operation: (client: typeof tx) => unknown, options?: { isolationLevel?: string }) => {
      attempts += 1;
      expect(options).toEqual({ isolationLevel: "Serializable" });
      const result = await operation(tx);
      // The first attempt did its work and then lost: PostgreSQL rolls it back (the raw lock query reports 40001 as P2010).
      if (attempts === 1) {
        tx.payment.create.mockClear();
        tx.auditLog.create.mockClear();
        throw new Prisma.PrismaClientKnownRequestError("could not serialize access", {
          code: "P2010", clientVersion: "test", meta: { code: "40001", message: "could not serialize access due to concurrent update" },
        });
      }
      return result;
    }) as never;

    await recordManualPayment("event-1", "registration-1", "user-1", {
      amountCents: 6500, method: "CHECK", reference: "", isDeposit: true,
    });

    expect(attempts).toBe(2);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.payment.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("answers PAYMENT_CONFLICT when every attempt loses", async () => {
    const { prisma } = staffClient();
    prisma.$transaction = vi.fn(async () => {
      throw new Prisma.PrismaClientKnownRequestError("could not serialize access", { code: "P2034", clientVersion: "test" });
    }) as never;
    await expect(recordManualPayment("event-1", "registration-1", "user-1", {
      amountCents: 6500, method: "CHECK", reference: "", isDeposit: true,
    })).rejects.toMatchObject({ code: "PAYMENT_CONFLICT" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(4);
  });

  it("an ordinary payment is unchanged and is not the deposit", async () => {
    const { tx } = staffClient();
    await recordManualPayment("event-1", "registration-1", "user-1", { amountCents: 2500, method: "CHECK", reference: "" });
    expect(tx.payment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ isDeposit: false }) });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "MANUAL_PAYMENT_RECORDED" }) });
  });

  it("refuses a repeated deposit, including one that raced past the first check", async () => {
    const first = staffClient({ payments: [{ amount: 65, isDeposit: true, refunds: [] }] });
    await expect(recordManualPayment("event-1", "registration-1", "user-1", {
      amountCents: 6500, method: "CHECK", reference: "", isDeposit: true,
    })).rejects.toMatchObject({ code: "DEPOSIT_ALREADY_RECORDED" });
    expect(first.prisma.$transaction).not.toHaveBeenCalled();

    // The locked re-read inside the transaction is what stops two simultaneous submissions.
    const raced = staffClient({ locked: [{ amount: 65, isDeposit: true, refunds: [] }] });
    await expect(recordManualPayment("event-1", "registration-1", "user-1", {
      amountCents: 6500, method: "CHECK", reference: "", isDeposit: true,
    })).rejects.toMatchObject({ code: "DEPOSIT_ALREADY_RECORDED" });
    expect(raced.tx.$queryRaw).toHaveBeenCalled();
    expect(raced.tx.payment.create).not.toHaveBeenCalled();
    expect(raced.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("does not hold the reservation for a check below the deposit, or on a form with no deposit", async () => {
    staffClient();
    await expect(recordManualPayment("event-1", "registration-1", "user-1", {
      amountCents: 5000, method: "CHECK", reference: "", isDeposit: true,
    })).rejects.toMatchObject({ code: "DEPOSIT_AMOUNT_TOO_LOW" });
    staffClient({ definition: { ...formDefinition, payment: { ...formDefinition.payment, deposit: undefined } } });
    await expect(recordManualPayment("event-1", "registration-1", "user-1", {
      amountCents: 6500, method: "CHECK", reference: "", isDeposit: true,
    })).rejects.toMatchObject({ code: "DEPOSIT_NOT_OFFERED" });
  });
});

describe("money movement under the registration lock (#415)", () => {
  function staffInputs(over: Partial<{ amountCents: number; isDeposit: boolean }> = {}) {
    return { amountCents: 6500, method: "CHECK" as const, reference: "", isDeposit: false, ...over };
  }

  it("recomputes the balance from the locked rows, not the pre-transaction read", async () => {
    // Nothing paid when the request was first checked, but $280 landed before the lock was taken.
    const { tx } = staffClient({ locked: [{ amount: 280, refunds: [] }] });
    await expect(recordManualPayment("event-1", "registration-1", "user-1", staffInputs()))
      .rejects.toMatchObject({ code: "PAYMENT_EXCEEDS_BALANCE" });
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it("takes the lock for an ordinary payment too, and audits the balance it actually saw", async () => {
    const { tx } = staffClient({ locked: [{ amount: 100, refunds: [] }] });
    await recordManualPayment("event-1", "registration-1", "user-1", staffInputs({ isDeposit: true }));
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({ balanceBeforeCents: 20_000, balanceAfterCents: 13_500 }),
      }),
    });
  });

  it("holds a card deposit that finishes after a check deposit as a duplicate: no fee, no second hold", async () => {
    const checkDeposit = { id: "payment-check", amount: 65, isDeposit: true, refunds: [] };
    const tx = transactionClient(registration({ method: "Pay later" }));
    const attempt = attemptFor();
    tx.registration.findUnique
      .mockResolvedValueOnce(registration({ method: "Pay later" }) as never)
      // Under the lock, the success path sees the check deposit staff recorded meanwhile.
      .mockResolvedValue({ ...registration({ method: "Pay later" }), payments: [checkDeposit] } as never);
    tx.paymentAttempt.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(attempt);
    tx.paymentAttempt.create.mockResolvedValue(attempt);
    tx.paymentAttempt.update.mockResolvedValue({ ...attempt, status: "SUCCEEDED", duplicateReason: "DEPOSIT_ALREADY_RECORDED" });
    tx.payment.create.mockResolvedValue({ id: "payment-card" });
    mocks.getPrisma.mockReturnValue(prismaFor(tx));

    await createPublicSquarePayment(
      token,
      { sourceId: "cnon:card-nonce-ok", idempotencyKey: attempt.clientIdempotencyKey, kind: "DEPOSIT" },
      {
        configuration,
        createPayment: vi.fn().mockResolvedValue({
          id: "square-payment-9", status: "COMPLETED", amountCents: 6726, currency: "USD",
          createdAt: "2027-03-30T13:00:00.000Z", updatedAt: "2027-03-30T13:00:01.000Z",
        }),
        now: new Date("2027-03-30T13:00:01.000Z"),
      },
    );

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.squareDuplicateCharge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ reason: "DEPOSIT_ALREADY_RECORDED", winningPaymentId: "payment-check" }),
    });
    // Held for review: pending payment (not counted), no fee on the total, no receipt, staff paged.
    expect(tx.payment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "PENDING" }) });
    expect(tx.registration.update).not.toHaveBeenCalled();
    expect(mocks.enqueuePaymentReceiptMessage).not.toHaveBeenCalled();
    expect(mocks.dispatchAlerts).toHaveBeenCalled();
  });

  it("audits a completed card deposit as the deposit, and words the fee for a deposit", async () => {
    const tx = transactionClient(registration({ method: "Pay later" }));
    const attempt = attemptFor();
    const succeeded = {
      ...attempt, paymentId: "payment-1", activeRegistrationKey: null, status: "SUCCEEDED",
      providerPaymentId: "square-payment-1", providerStatus: "COMPLETED",
      payment: { id: "payment-1", amount: 67.26, isDeposit: true, status: "SUCCEEDED", method: "CARD_REFERENCE", receivedAt: new Date() },
    };
    tx.paymentAttempt.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(attempt);
    tx.paymentAttempt.create.mockResolvedValue(attempt);
    tx.paymentAttempt.update.mockResolvedValue(succeeded);
    tx.payment.create.mockResolvedValue(succeeded.payment);
    mocks.getPrisma.mockReturnValue(prismaFor(tx));
    await createPublicSquarePayment(
      token,
      { sourceId: "cnon:card-nonce-ok", idempotencyKey: attempt.clientIdempotencyKey, kind: "DEPOSIT" },
      {
        configuration,
        createPayment: vi.fn().mockResolvedValue({
          id: "square-payment-1", status: "COMPLETED", amountCents: 6726, currency: "USD",
          createdAt: "2027-03-30T13:00:00.000Z", updatedAt: "2027-03-30T13:00:01.000Z",
        }),
        now: new Date("2027-03-30T13:00:01.000Z"),
      },
    );
    const audits = tx.auditLog.create.mock.calls.map((call) => (call[0] as { data: Record<string, unknown> }).data);
    expect(audits.find((data) => data.action === "SQUARE_PAYMENT_COMPLETED")?.metadata)
      .toMatchObject({ isDeposit: true, paymentKind: "DEPOSIT" });
    const fee = audits.find((data) => data.action === "REGISTRATION_CARD_SURCHARGE_APPLIED");
    expect(fee?.summary).toContain("reservation deposit");
    expect(fee?.metadata).toMatchObject({ isDeposit: true, paymentKind: "DEPOSIT", surchargeCents: 226 });
  });
});

describe("Pay on Square deposit links (#415)", () => {
  const returnId = "R".repeat(43);
  const linkKey = "11111111-2222-4333-8444-555555555555";
  const appBaseUrl = "https://events.imsda.test";

  function hostedAttempt(over: Record<string, unknown> = {}) {
    return attemptFor({
      channel: "HOSTED_LINK",
      activeRegistrationKey: null,
      hostedCheckout: {
        id: "hosted-1", status: "CREATING", checkoutUrl: null,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        returnTokenHash: "hash",
      },
      ...over,
    }) as ReturnType<typeof attemptFor> & { hostedCheckout: Record<string, unknown> };
  }

  function hostedTx(loaded = registration({ method: "Pay later" })) {
    const tx = transactionClient(loaded);
    tx.paymentAttempt.findUnique.mockResolvedValue(null);
    mocks.getPrisma.mockReturnValue(prismaFor(tx));
    return tx;
  }

  it("creates a deposit link for the deposit plus its fee, marked as the deposit", async () => {
    const tx = hostedTx();
    const created = hostedAttempt();
    tx.paymentAttempt.create.mockResolvedValue(created);
    tx.paymentAttempt.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) => (where.id ? created : null));
    tx.squareHostedCheckout.update.mockResolvedValue({ ...created.hostedCheckout, status: "ACTIVE", checkoutUrl: "https://sandbox.square.link/u/dep" });
    const createLink = vi.fn().mockResolvedValue({ id: "LINK-1", orderId: "ORDER-1", url: "https://sandbox.square.link/u/dep" });

    const link = await createPublicSquarePaymentLink(
      token,
      { idempotencyKey: linkKey, returnId, kind: "DEPOSIT" },
      { configuration, createLink, appBaseUrl, now: new Date("2027-03-30T13:00:00.000Z") },
    );

    expect(tx.paymentAttempt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ channel: "HOSTED_LINK", isDeposit: true, amountCents: 6726, surchargeCents: 226 }),
    }));
    expect(createLink).toHaveBeenCalledWith(configuration, expect.objectContaining({ amountCents: 6726 }));
    expect(link).toMatchObject({ amountCents: 6726, surchargeCents: 226 });
  });

  it("does not reuse an open balance link for a deposit, but reuses an open deposit link", async () => {
    const openBalance = hostedAttempt({
      id: "attempt-balance", isDeposit: false, amountCents: 30_927, surchargeCents: 927,
      hostedCheckout: { id: "hosted-b", status: "ACTIVE", checkoutUrl: "https://sandbox.square.link/u/bal", expiresAt: new Date("2099-01-01T00:00:00.000Z"), returnTokenHash: "hash" },
    });
    const tx = hostedTx();
    tx.paymentAttempt.findMany.mockResolvedValue([openBalance]);
    const fresh = hostedAttempt({ id: "attempt-new" });
    tx.paymentAttempt.create.mockResolvedValue(fresh);
    tx.paymentAttempt.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) => (where.id ? fresh : null));
    tx.squareHostedCheckout.update.mockResolvedValue({ ...fresh.hostedCheckout, status: "ACTIVE", checkoutUrl: "https://sandbox.square.link/u/dep" });
    const createLink = vi.fn().mockResolvedValue({ id: "LINK-2", orderId: "ORDER-2", url: "https://sandbox.square.link/u/dep" });
    await createPublicSquarePaymentLink(token, { idempotencyKey: linkKey, returnId, kind: "DEPOSIT" }, { configuration, createLink, appBaseUrl });
    expect(tx.paymentAttempt.create).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateHosted).toHaveBeenCalledWith(tx, expect.objectContaining({ reason: "SUPERSEDED_BY_NEW_LINK" }));

    const openDeposit = hostedAttempt({
      id: "attempt-deposit",
      hostedCheckout: { id: "hosted-d", status: "ACTIVE", checkoutUrl: "https://sandbox.square.link/u/dep", expiresAt: new Date("2099-01-01T00:00:00.000Z"), returnTokenHash: "hash" },
    });
    const again = hostedTx();
    again.paymentAttempt.findMany.mockResolvedValue([openDeposit]);
    const reuseLink = vi.fn();
    const reused = await createPublicSquarePaymentLink(token, { idempotencyKey: "99999999-2222-4333-8444-555555555555", returnId, kind: "DEPOSIT" }, { configuration, createLink: reuseLink, appBaseUrl });
    expect(reused).toMatchObject({ url: "https://sandbox.square.link/u/dep", amountCents: 6726 });
    expect(again.paymentAttempt.create).not.toHaveBeenCalled();
    expect(reuseLink).not.toHaveBeenCalled();
  });

  it("refuses a deposit link once the deposit is recorded instead of linking the whole balance", async () => {
    const tx = hostedTx(registration({
      method: "Pay later", totalAmount: 302.26,
      payments: [{ amount: 67.26, isDeposit: true, refunds: [] }],
    }));
    const createLink = vi.fn();
    await expect(createPublicSquarePaymentLink(token, { idempotencyKey: linkKey, returnId, kind: "DEPOSIT" }, { configuration, createLink, appBaseUrl }))
      .rejects.toMatchObject({ code: "DEPOSIT_UNAVAILABLE" });
    expect(tx.paymentAttempt.create).not.toHaveBeenCalled();
    expect(createLink).not.toHaveBeenCalled();
  });
});
