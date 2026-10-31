import { beforeEach, describe, expect, it, vi } from "vitest";
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

import { submitPublicRegistration } from "@/modules/forms/public-repository";

const definition = registrationFormDefinitionSchema.parse({
  title: "Legacy attendee type wiring",
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
      { id: "type", key: "attendee_type", label: "Attendee type", helpText: "", type: "RADIO", scope: "ATTENDEE", required: true, options: ["Adult", "Teen", "Child", "Guest"] },
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
    attendee_type: "Adult",
  },
  website: "",
});

function transactionFixture() {
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
          capacity: 1,
          isPublished: true,
          registrationOpensOn: "2026-08-01",
          registrationClosesOn: "2026-08-19",
          waitlistEnabled: true,
          audience: "GENERAL",
          billingMode: "ATTENDEE_PAY",
          attendeeTypes: [
            { id: "type-adult", code: "ADULT", label: "Adult", isActive: true },
            { id: "type-teen", code: "TEEN", label: "Teen", isActive: true },
          ],
        },
        versions: [{
          id: "version-1",
          versionNumber: 1,
          definition,
          publishedAt: new Date("2026-07-01T12:00:00.000Z"),
        }],
      }),
    },
    publicRegistrationSubmission: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "submission-1" }),
    },
    registrationCapacityReservation: {
      findMany: vi.fn().mockResolvedValue([
        { fieldId: "room", optionValue: "Cabin", rank: null },
      ]),
      createMany: vi.fn(),
    },
    registrationAttendee: {
      count: vi.fn().mockResolvedValue(1),
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
      findMany: vi.fn(),
    },
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

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.processQueuedMessageIdsAfterCommit.mockResolvedValue({
    capturedIds: [],
    sentIds: [],
    failedIds: [],
    rescheduledIds: [],
    skippedIds: [],
  });
  dependencies.enqueueWaitlistJoinedMessage.mockResolvedValue({
    messageIds: ["waitlist-message"],
    pendingMessageIds: ["waitlist-message"],
    deliveryMode: "LOCAL_CAPTURE",
    skippedReason: null,
  });
});


describe("registration links the legacy attendee_type answer to an event type (#1403)", () => {
  async function attendeeData(answer: string, audience = "GENERAL") {
    const { prisma, tx } = transactionFixture();
    (tx.registrationForm.findFirst as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue(
      { ...(await tx.registrationForm.findFirst()), event: { ...(await tx.registrationForm.findFirst()).event, audience } },
    );
    dependencies.getPrisma.mockReturnValue(prisma);
    await submitPublicRegistration("summer-retreat", "attendee", { ...input, responses: { ...input.responses, attendee_type: answer } }, new Date("2026-08-10T12:00:00.000Z"));
    return (tx.registrationAttendee.create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
  }

  it("types an attendee whose answer matches a type's label exactly", async () => {
    expect(await attendeeData("Adult")).toMatchObject({ attendeeTypeDefinitionId: "type-adult" });
  });

  it("never types from the answer unless the event is a general one", async () => {
    expect(await attendeeData("Adult", "NOT_GENERAL")).toMatchObject({ attendeeTypeDefinitionId: null });
  });

  it("leaves an answer with no exact match untyped", async () => {
    expect(await attendeeData("Guest")).toMatchObject({ attendeeTypeDefinitionId: null });
  });
});
