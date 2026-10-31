import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import { publicRegistrationInputSchema } from "@/modules/forms/public-domain";

const dependencies = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  processQueuedMessageIdsAfterCommit: vi.fn(),
  enqueuePublicRegistrationMessages: vi.fn(),
  enqueueWaitlistJoinedMessage: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));
vi.mock("@/modules/communications/messaging-repository", () => ({
  processQueuedMessageIdsAfterCommit: dependencies.processQueuedMessageIdsAfterCommit,
  enqueuePublicRegistrationMessages: dependencies.enqueuePublicRegistrationMessages,
}));
vi.mock("@/modules/communications/transactional-messages", () => ({
  enqueueWaitlistJoinedMessage: dependencies.enqueueWaitlistJoinedMessage,
}));

vi.mock("@/modules/background-checks/refresh-after-write", () => ({ refreshBackgroundCheckMatchesForRegistrations: vi.fn() }));
vi.mock("@/modules/registration-pdf/after-commit", () => ({ attachRegistrationPdfAfterCommit: vi.fn() }));
vi.mock("@/modules/registration-form-notifications/after-commit", () => ({ finishFormNotificationsAfterSubmit: vi.fn() }));

import { submitPublicRegistration } from "@/modules/forms/public-repository";

const definition = registrationFormDefinitionSchema.parse({
  title: "Card fee deferral verification",
  description: "Fictitious registration used by the waitlist transaction test.",
  confirmationMessage: "This normal registration would be confirmed.",
  payment: {
    enabled: true,
    currency: "USD",
    paymentMethodFieldKey: "payment_method",
    cardOptionValue: "Credit / debit card",
    percentageBasisPoints: 290,
    fixedFeeCents: 30,
    passFeeToRegistrant: true,
  },
  sections: [{
    id: "contact",
    title: "Contact",
    description: "",
    fields: [
      { id: "first", key: "first_name", label: "First name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
      { id: "last", key: "last_name", label: "Last name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
      { id: "email", key: "email", label: "Email", helpText: "", type: "EMAIL", scope: "REGISTRATION", required: true, options: [] },
      { id: "room", key: "room", label: "Room", helpText: "", type: "RADIO", scope: "REGISTRATION", required: true, options: ["Cabin", "Commuting"], availabilityMode: "CAPACITY", choiceLimits: { Cabin: 1 } },
      { id: "fee", key: "registration_fee", label: "Registration fee", helpText: "", type: "CALCULATED", scope: "REGISTRATION", required: false, options: [], priceCents: 10000 },
      { id: "payment", key: "payment_method", label: "Payment method", helpText: "", type: "RADIO", scope: "REGISTRATION", required: true, options: ["Pay later", "Credit / debit card"] },
    ],
  }],
});

const input = publicRegistrationInputSchema.parse({
  versionId: "version-1",
  idempotencyKey: "b64a0acb-3711-48c2-ab8c-cdae084857eb",
  responses: {
    first_name: "Waitlist",
    last_name: "Tester",
    email: "waitlist.tester@example.test",
    room: "Cabin",
    payment_method: "Credit / debit card",
  },
  website: "",
});

function transactionFixture(formDefinition: unknown = definition) {
  const tx = {
    // The submission gate (#920): the first statement of an individual submission.
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    registrationForm: {
      findFirst: vi.fn().mockResolvedValue({
        id: "form-1",
        slug: "attendee",
        eventId: "event-1",
        event: {
          id: "event-1",
          name: "Summer Retreat",
          slug: "summer-retreat",
          startsAt: new Date("2026-08-20T14:00:00.000Z"),
          endsAt: new Date("2026-08-22T18:00:00.000Z"),
          timezone: "America/Chicago",
          location: "Test venue",
          capacity: null,
          isPublished: true,
          registrationOpensOn: "2026-08-01",
          registrationClosesOn: "2026-08-19",
          waitlistEnabled: false,
        },
        versions: [{
          id: "version-1",
          versionNumber: 1,
          definition: formDefinition,
          publishedAt: new Date("2026-07-01T12:00:00.000Z"),
        }],
      }),
    },
    publicRegistrationSubmission: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "submission-1" }),
    },
    registrationCapacityReservation: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn(),
    },
    registrationAttendee: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: "attendee-1" }),
    },
    person: {
      upsert: vi.fn().mockResolvedValue({
        id: "person-1",
        firstName: "Waitlist",
        lastName: "Tester",
        normalizedEmail: "waitlist.tester@example.test",
      }),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    registration: {
      create: vi.fn().mockResolvedValue({ id: "registration-1" }),
      findUnique: vi.fn().mockResolvedValue({
        eventId: "event-1",
        confirmationCode: "REG-WAITLIST",
        event: { endsAt: new Date("2026-08-22T18:00:00.000Z") },
      }),
    },
    registrationAccessToken: {
      create: vi.fn().mockResolvedValue({ id: "access-1" }),
    },
    registrationLedgerEntry: { create: vi.fn().mockResolvedValue({ id: "ledger-1" }) },
    registrationWaitlistEntry: {
      aggregate: vi.fn().mockResolvedValue({ _max: { position: null } }),
      create: vi.fn().mockResolvedValue({ id: "waitlist-1" }),
    },
    messageOutbox: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    registrationFormNotification: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: "audit-1" }),
    },
  };
  const prisma = {
    registrationFormNotification: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
  };
  return { prisma, tx };
}


const squareEnvironment = {
  SQUARE_APPLICATION_ID: "sandbox-sq0idb-example",
  SQUARE_LOCATION_ID: "sandbox-location",
  SQUARE_ACCESS_TOKEN: "sandbox-access-token",
  SQUARE_WEBHOOK_SIGNATURE_KEY: "sandbox-signature-key",
  SQUARE_WEBHOOK_NOTIFICATION_URL: "https://events.imsda.test/api/webhooks/square",
};

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.processQueuedMessageIdsAfterCommit.mockResolvedValue({
    capturedIds: [],
    sentIds: [],
    failedIds: [],
    rescheduledIds: [],
    skippedIds: [],
  });
  dependencies.enqueuePublicRegistrationMessages.mockResolvedValue({
    messageIds: [],
    pendingMessageIds: [],
    registrantMessageIds: [],
    deliveryMode: "LOCAL_CAPTURE",
    skippedReason: null,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function configureSquare(configured: boolean) {
  for (const [key, value] of Object.entries(squareEnvironment)) vi.stubEnv(key, configured ? value : "");
}

describe("card fee only when card payment is possible (#1405)", () => {
  it("refuses a card answer when online payment is not configured, and writes nothing", async () => {
    configureSquare(false);
    const { prisma, tx } = transactionFixture();
    dependencies.getPrisma.mockReturnValue(prisma);

    await expect(
      submitPublicRegistration("summer-retreat", "attendee", input, new Date("2026-08-10T12:00:00.000Z")),
    ).rejects.toMatchObject({
      code: "INVALID_SUBMISSION",
      issues: [expect.objectContaining({ key: "payment_method", message: expect.stringContaining("Card payment is not available") })],
    });
    expect(tx.registration.create).not.toHaveBeenCalled();
    expect(tx.publicRegistrationSubmission.create).not.toHaveBeenCalled();
  });

  it("still takes a pay-later answer when online payment is not configured, with no fee", async () => {
    configureSquare(false);
    const { prisma, tx } = transactionFixture();
    dependencies.getPrisma.mockReturnValue(prisma);

    const confirmation = await submitPublicRegistration(
      "summer-retreat",
      "attendee",
      { ...input, responses: { ...input.responses, payment_method: "Pay later" } },
      new Date("2026-08-10T12:00:00.000Z"),
    );

    expect(tx.registration.create).toHaveBeenCalledWith({ data: expect.objectContaining({ totalAmount: 100 }) });
    expect(confirmation).toMatchObject({ totalCents: 10_000, processingFeeCents: 0, cardSelected: false });
  });

  it("stores a new card registration's total without the online fee and marks the fee deferred", async () => {
    configureSquare(true);
    const { prisma, tx } = transactionFixture();
    dependencies.getPrisma.mockReturnValue(prisma);

    const confirmation = await submitPublicRegistration(
      "summer-retreat",
      "attendee",
      input,
      new Date("2026-08-10T12:00:00.000Z"),
    );

    // The balance, the snapshot and the ledger charge are all the $100.00 subtotal; the $3.30 fee joins the total
    // when the person pays online by card.
    expect(tx.registration.create).toHaveBeenCalledWith({ data: expect.objectContaining({ totalAmount: 100 }) });
    expect(tx.publicRegistrationSubmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pricingSnapshot: expect.objectContaining({
          subtotalCents: 10_000,
          processingFeeCents: 0,
          totalCents: 10_000,
          cardSelected: true,
          cardFeeDeferred: true,
        }),
      }),
    });
    expect(tx.registrationLedgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amountCents: 10_000 }) }),
    );
    // The confirmation says what the form showed, so it can explain the fee that is added when paying online.
    expect(confirmation).toMatchObject({ totalCents: 10_000, processingFeeCents: 0, cardSelected: true, deferredCardFeeCents: 330 });
    expect(tx.publicRegistrationSubmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ pricingSnapshot: expect.objectContaining({ deferredCardFeeCents: 330 }) }),
    });
    // The ledger's money snapshot records the marker too.
    expect(tx.registrationLedgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pricingSnapshot: expect.objectContaining({ cardFeeDeferred: true }) }) }),
    );
  });

  describe("a form whose only payment choices are online", () => {
    const onlineOnly = (options: string[], deposit = false) => registrationFormDefinitionSchema.parse({
      ...definition,
      payment: { ...definition.payment, ...(deposit ? { deposit: { enabled: true, amountCents: 2_500, optionValue: "Pay a deposit now by card" } } : {}) },
      sections: [{
        ...definition.sections[0],
        fields: definition.sections[0]!.fields.map((field) => (field.key === "payment_method" ? { ...field, options } : field)),
      }],
    });
    const withoutAnswer = { ...input, responses: Object.fromEntries(Object.entries(input.responses).filter(([key]) => key !== "payment_method")) };

    it("drops the required payment field when Square is off, so the registration saves as pay-later with no fee", async () => {
      configureSquare(false);
      const { prisma, tx } = transactionFixture(onlineOnly(["Pay a deposit now by card", "Credit / debit card"], true));
      dependencies.getPrisma.mockReturnValue(prisma);

      const confirmation = await submitPublicRegistration("summer-retreat", "attendee", withoutAnswer, new Date("2026-08-10T12:00:00.000Z"));

      expect(confirmation).toMatchObject({ totalCents: 10_000, processingFeeCents: 0, cardSelected: false });
      const snapshot = (tx.publicRegistrationSubmission.create.mock.calls[0]![0] as { data: { pricingSnapshot: Record<string, unknown> } }).data.pricingSnapshot;
      expect(snapshot).not.toHaveProperty("cardFeeDeferred");
    });

    it("still refuses a card answer posted to a card-only form when Square is off", async () => {
      configureSquare(false);
      const { prisma, tx } = transactionFixture(onlineOnly(["Pay a deposit now by card", "Credit / debit card"], true));
      dependencies.getPrisma.mockReturnValue(prisma);

      await expect(submitPublicRegistration("summer-retreat", "attendee", input, new Date("2026-08-10T12:00:00.000Z")))
        .rejects.toMatchObject({ code: "INVALID_SUBMISSION", issues: [expect.objectContaining({ key: "payment_method" })] });
      expect(tx.registration.create).not.toHaveBeenCalled();
    });

    it("refuses the deposit answer too when Square is off", async () => {
      configureSquare(false);
      const { prisma, tx } = transactionFixture(onlineOnly(["Pay later", "Pay a deposit now by card", "Credit / debit card"], true));
      dependencies.getPrisma.mockReturnValue(prisma);

      await expect(submitPublicRegistration(
        "summer-retreat", "attendee",
        { ...input, responses: { ...input.responses, payment_method: "Pay a deposit now by card" } },
        new Date("2026-08-10T12:00:00.000Z"),
      )).rejects.toMatchObject({ code: "INVALID_SUBMISSION", issues: [expect.objectContaining({ key: "payment_method" })] });
      expect(tx.registration.create).not.toHaveBeenCalled();
    });
  });
});
