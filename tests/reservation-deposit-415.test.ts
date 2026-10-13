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
vi.mock("@/modules/registrations/repository", () => ({
  getRegistrationById: mocks.getRegistrationById,
}));
vi.mock("@/modules/payments/square-hosted-invalidation", () => ({
  invalidateHostedCheckoutsInTransaction: mocks.invalidateHosted,
  flushHostedDeletionsAfterResponse: mocks.flushHosted,
}));

import type { SquareRuntimeConfiguration } from "@/modules/payments/square-config";
import { recordManualPayment } from "@/modules/payments/repository";
import {
  createPublicSquarePayment,
  getPublicSquareCheckout,
} from "@/modules/payments/square-repository";

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
    event: { billingMode: "ATTENDEE_PAY", hostedPaymentLinkEnabled: false },
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
    registration: {
      findUnique: vi.fn().mockResolvedValue(loaded),
      update: vi.fn().mockResolvedValue({ totalAmount: 302.26 }),
    },
    paymentAttempt: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    payment: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    squareDuplicateCharge: {
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    squareHostedCheckout: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
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

describe("staff-recorded check deposit (#415)", () => {
  function staffClient(options: { payments?: PaymentRow[]; recorded?: PaymentRow[]; definition?: unknown } = {}) {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      payment: {
        findMany: vi.fn().mockResolvedValue(options.recorded ?? []),
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
    const raced = staffClient({ recorded: [{ amount: 65, isDeposit: true, refunds: [] }] });
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
