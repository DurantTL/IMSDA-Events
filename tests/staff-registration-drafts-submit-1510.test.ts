import { beforeEach, describe, expect, it, vi } from "vitest";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import { publicRegistrationInputSchema } from "@/modules/forms/public-domain";
import { hashOpaqueToken } from "@/modules/access/tokens";

const dependencies = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  processQueuedMessageIdsAfterCommit: vi.fn(),
  enqueuePublicRegistrationMessages: vi.fn(),
  enqueueWaitlistJoinedMessage: vi.fn(),
  refreshBackgroundCheckMatches: vi.fn(),
  attachRegistrationPdf: vi.fn(),
  finishFormNotifications: vi.fn(),
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
vi.mock("@/modules/background-checks/refresh-after-write", () => ({ refreshBackgroundCheckMatchesForRegistrations: dependencies.refreshBackgroundCheckMatches }));
vi.mock("@/modules/registration-pdf/after-commit", () => ({ attachRegistrationPdfAfterCommit: dependencies.attachRegistrationPdf }));
vi.mock("@/modules/registration-form-notifications/after-commit", () => ({ finishFormNotificationsAfterSubmit: dependencies.finishFormNotifications }));

import { checkPublicRegistration, submitPublicRegistration } from "@/modules/forms/public-repository";

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
    $queryRaw: vi.fn().mockResolvedValue([]),
    staffRegistrationDraft: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue({}) },
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
    // Like the database: the work is kept only when the callback finishes; a thrown error is a rollback.
    committed: 0,
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => {
      const result = await operation(tx);
      prisma.committed += 1;
      return result;
    }),
  };
  return { prisma, tx };
}



const token = "T".repeat(43);
const submittedAt = new Date("2026-08-10T12:00:00.000Z");
const handedOffDraft = {
  id: "draft-1",
  eventId: "event-1",
  formId: "form-1",
  status: "HANDED_OFF",
  handOffExpiresAt: new Date("2026-08-20T12:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.processQueuedMessageIdsAfterCommit.mockResolvedValue({ capturedIds: [], sentIds: [], failedIds: [], rescheduledIds: [], skippedIds: [] });
  dependencies.enqueuePublicRegistrationMessages.mockResolvedValue({ messageIds: [], pendingMessageIds: [], registrantMessageIds: [], deliveryMode: "LOCAL_CAPTURE", skippedReason: null });
  vi.stubEnv("SQUARE_ACCESS_TOKEN", "");
});

const payLater = { ...input, responses: { ...input.responses, payment_method: "Pay later" } };

function withDraft(tx: ReturnType<typeof transactionFixture>["tx"], draft: Partial<typeof handedOffDraft> | null) {
  tx.$queryRaw.mockResolvedValue(draft ? [{ id: "draft-1" }] : []);
  tx.staffRegistrationDraft.findUnique.mockResolvedValue(draft ? { ...handedOffDraft, ...draft } : null);
}

describe("staff check runs the public submit and keeps nothing (#1510)", () => {
  it("returns the total and the seat decision, rolls the transaction back and runs no after-commit step", async () => {
    const { prisma, tx } = transactionFixture();
    dependencies.getPrisma.mockReturnValue(prisma);

    const result = await checkPublicRegistration("summer-retreat", "attendee", payLater, submittedAt);

    expect(result).toMatchObject({ registrationStatus: "SUBMITTED", totalCents: 10_000, promoCode: null });
    expect(result.lineItems.length).toBeGreaterThan(0);
    // The shared path really ran (the registration was built inside the transaction) ...
    expect(tx.registration.create).toHaveBeenCalled();
    // ... and then the transaction ended in an error, so the database keeps none of it.
    expect(prisma.committed).toBe(0);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
    expect(dependencies.processQueuedMessageIdsAfterCommit).not.toHaveBeenCalled();
    expect(dependencies.refreshBackgroundCheckMatches).not.toHaveBeenCalled();
    expect(dependencies.attachRegistrationPdf).not.toHaveBeenCalled();
    expect(dependencies.finishFormNotifications).not.toHaveBeenCalled();
  });

  it("never touches a draft, even when a token is passed", async () => {
    const { prisma, tx } = transactionFixture();
    dependencies.getPrisma.mockReturnValue(prisma);
    withDraft(tx, {});

    await checkPublicRegistration("summer-retreat", "attendee", { ...payLater, staffDraftToken: token }, submittedAt);

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.staffRegistrationDraft.update).not.toHaveBeenCalled();
  });

  it("surfaces the form's own problems", async () => {
    const { prisma } = transactionFixture();
    dependencies.getPrisma.mockReturnValue(prisma);

    await expect(
      checkPublicRegistration("summer-retreat", "attendee", { ...payLater, responses: { ...payLater.responses, email: "" } }, submittedAt),
    ).rejects.toMatchObject({ code: "INVALID_SUBMISSION", issues: expect.arrayContaining([expect.objectContaining({ key: "email" })]) });
    expect(prisma.committed).toBe(0);
  });

  it("refuses when the form was published again since the draft was pinned", async () => {
    const { prisma } = transactionFixture();
    dependencies.getPrisma.mockReturnValue(prisma);

    await expect(
      checkPublicRegistration("summer-retreat", "attendee", { ...payLater, versionId: "version-0" }, submittedAt),
    ).rejects.toMatchObject({ code: "FORM_VERSION_CHANGED" });
  });
});

describe("a registrant submitting from a staff-started link (#1510)", () => {
  it("links the draft to the registration in the same transaction, clears its answers and audits it", async () => {
    const { prisma, tx } = transactionFixture();
    dependencies.getPrisma.mockReturnValue(prisma);
    withDraft(tx, {});

    await submitPublicRegistration("summer-retreat", "attendee", { ...payLater, staffDraftToken: token }, submittedAt);

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(String(tx.$queryRaw.mock.calls[0]?.[0]?.join?.("") ?? "")).toContain("FOR UPDATE");
    expect(tx.$queryRaw.mock.calls[0]?.[1]).toBe(hashOpaqueToken(token));
    expect(tx.staffRegistrationDraft.update).toHaveBeenCalledWith({
      where: { id: "draft-1" },
      data: expect.objectContaining({ status: "SUBMITTED", registrationId: "registration-1", submittedAt, responses: {} }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "STAFF_REGISTRATION_DRAFT_SUBMITTED", entityId: "draft-1" }),
    });
    expect(prisma.committed).toBe(1);
    // The registration is made by the ordinary path: no payment row, no attempt.
    expect(tx.registration.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain("waitlist.tester@example.test");
  });

  it("replays for the same key and does not look at the draft again", async () => {
    const { prisma, tx } = transactionFixture();
    dependencies.getPrisma.mockReturnValue(prisma);
    withDraft(tx, {});
    const first = await submitPublicRegistration("summer-retreat", "attendee", { ...payLater, staffDraftToken: token }, submittedAt);
    const stored = tx.publicRegistrationSubmission.create.mock.calls[0]![0].data;
    tx.publicRegistrationSubmission.findUnique.mockResolvedValue({
      ...stored,
      eventId: "event-1",
      registrationId: "registration-1",
      registration: { confirmationCode: first.confirmationCode, status: "SUBMITTED", waitlistEntry: null },
    });
    tx.$queryRaw.mockClear();
    tx.registration.create.mockClear();

    const again = await submitPublicRegistration("summer-retreat", "attendee", { ...payLater, staffDraftToken: token }, submittedAt);

    expect(again.confirmationCode).toBe(first.confirmationCode);
    expect(tx.registration.create).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("refuses a repeat with a new key once the draft was submitted, and creates nothing", async () => {
    const { prisma, tx } = transactionFixture();
    dependencies.getPrisma.mockReturnValue(prisma);
    withDraft(tx, { status: "SUBMITTED" });

    await expect(
      submitPublicRegistration("summer-retreat", "attendee", { ...payLater, idempotencyKey: "0f8fad5b-d9cb-469f-a165-70867728950e", staffDraftToken: token }, submittedAt),
    ).rejects.toMatchObject({ code: "STAFF_DRAFT_ALREADY_SUBMITTED", message: "This registration was already sent. Check your email for the confirmation." });
    expect(tx.registration.create).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown link", null],
    ["an expired link", { handOffExpiresAt: new Date("2026-08-09T12:00:00.000Z") }],
    ["a withdrawn link", { status: "OPEN" }],
    ["a link for another form", { formId: "form-2" }],
    ["a link for another event", { eventId: "event-2" }],
  ] as const)("refuses %s with one plain message", async (_name, draft) => {
    const { prisma, tx } = transactionFixture();
    dependencies.getPrisma.mockReturnValue(prisma);
    withDraft(tx, draft as Partial<typeof handedOffDraft> | null);

    await expect(
      submitPublicRegistration("summer-retreat", "attendee", { ...payLater, staffDraftToken: token }, submittedAt),
    ).rejects.toMatchObject({ code: "STAFF_DRAFT_LINK_UNAVAILABLE", message: "This link has been used or has expired." });
    expect(tx.registration.create).not.toHaveBeenCalled();
    expect(tx.staffRegistrationDraft.update).not.toHaveBeenCalled();
  });

  it("does not accept a draft link on a club or group submission", async () => {
    const { prisma, tx } = transactionFixture();
    dependencies.getPrisma.mockReturnValue(prisma);
    withDraft(tx, {});
    const bulk = { organizationId: "org-1", locationId: null, prepareAttendees: vi.fn() } as never;

    await expect(
      submitPublicRegistration("summer-retreat", "attendee", { ...payLater, staffDraftToken: token }, submittedAt, bulk),
    ).rejects.toBeDefined();
    expect(tx.staffRegistrationDraft.update).not.toHaveBeenCalled();
  });

  it("does not change the replay hash: a token never makes the same answers look different", async () => {
    const { submissionHash } = await import("@/modules/forms/public-repository");
    expect(submissionHash({ ...payLater, staffDraftToken: token })).toBe(submissionHash(payLater));
  });
});
