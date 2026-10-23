import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The real effective-delivery module decides paused / not configured / on (#1043); only "can this environment email" is faked.
vi.mock("@/modules/communications/account-email", () => ({ isAccountEmailConfigured: () => true }));

import { enqueuePublicRegistrationMessages, type RegistrationMessageInput } from "@/modules/communications/messaging-repository";
import { enqueueRegistrationUpdatedMessage } from "@/modules/communications/transactional-messages";
import { queueStaffUpdatedRegistrationCopies, REGISTRANT_UPDATED_PDF_NOTE, STAFF_UPDATED_PDF_NOTE } from "@/modules/registration-pdf/notices";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";

/** The registration PDF rides the confirmation, the staff copy and the "Updated" re-send (#1082). Synthetic data only. */

const definition = registrationFormDefinitionSchema.parse({
  title: "Synthetic camporee",
  description: "",
  confirmationMessage: "Received.",
  attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 50, attendeeLabel: "Person", addButtonLabel: "Add" },
  sections: [{ id: "details", title: "Details", description: "", fields: [
    { id: "note_field", key: "note", label: "Note", type: "TEXT", scope: "REGISTRATION", required: false, helpText: "", options: [] },
    { id: "first_field", key: "first_name", label: "First name", type: "TEXT", scope: "ATTENDEE", required: true, helpText: "", options: [] },
    { id: "last_field", key: "last_name", label: "Last name", type: "TEXT", scope: "ATTENDEE", required: true, helpText: "", options: [] },
  ] }],
});

function settingsRow(paused: boolean) {
  return {
    id: "settings-1",
    eventId: "event-1",
    deliveryMode: "EXTERNAL_EMAIL",
    deliveryPaused: paused,
    deliveryPausedAt: null,
    deliveryPausedByUserId: null,
    senderName: null,
    senderEmail: null,
    replyToEmail: null,
    internalNotificationEmails: ["team@example.test", "Team@Example.test", "second@example.test"],
  };
}

function baseTx(paused: boolean) {
  return {
    eventMessageSettings: { findUnique: vi.fn().mockResolvedValue(settingsRow(paused)) },
    platformSettings: { findUnique: vi.fn().mockResolvedValue({ defaultSenderName: "IMSDA Events", defaultSenderEmail: "events@example.test", defaultReplyToEmail: "office@example.test" }) },
  };
}

function submitFixture(paused: boolean) {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: `message-${create.mock.calls.length}`, ...data }));
  const tx = {
    ...baseTx(paused),
    eventMessageTemplate: { findMany: vi.fn().mockResolvedValue([]) },
    event: { findUnique: vi.fn().mockResolvedValue({ supportContact: "office@example.test", paymentInstructionVersions: [] }) },
    registrationAttendee: { findMany: vi.fn().mockResolvedValue([{ id: "attendee-1" }]) },
    adminAlertFeedItem: { createMany: vi.fn(async () => ({ count: 1 })) },
    messageOutbox: { create, findMany: vi.fn().mockResolvedValue([]) },
    messageOutboxFile: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    messageTemplateVersionFile: { findMany: vi.fn().mockResolvedValue([]) },
    messageFile: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { tx, create };
}

function submitInput(overrides: Partial<RegistrationMessageInput> = {}): RegistrationMessageInput {
  return {
    staffCopyEnabled: true,
    event: { id: "event-1", name: "Synthetic Camporee", slug: "synthetic-camporee", startsAt: new Date("2027-02-19T21:00:00.000Z"), endsAt: new Date("2027-02-21T17:00:00.000Z"), timezone: "America/Chicago", location: "Camp", billingMode: "ATTENDEE_PAY" },
    registration: { id: "registration-1", confirmationCode: "REG-CLUB", attendeeType: "ATTENDEE" },
    formVersionId: "version-1",
    submissionIdempotencyKey: "2f0e3c1a-7a55-4c43-8e1c-2f6f6f4a9a10",
    identity: { firstName: "Pat", lastName: "Director", email: "pat@example.test" } as RegistrationMessageInput["identity"],
    definition,
    responses: {},
    calculation: { subtotalCents: 2500, processingFeeCents: 0, totalCents: 2500, lineItems: [{ key: "fee", label: "Fee", amountCents: 2500 }] },
    ...overrides,
  };
}

function registrationRow() {
  return {
    id: "registration-1",
    confirmationCode: "REG-1234",
    status: "CONFIRMED",
    totalAmount: { toString: () => "250.00" },
    contactSnapshot: { firstName: "Pat", lastName: "Director", email: "pat@example.test" },
    accountHolderPerson: { firstName: "Pat", lastName: "Director", normalizedEmail: "pat@example.test" },
    publicFormSubmission: { pricingSnapshot: {} },
    operations: [],
    location: null,
    event: { name: "Synthetic Camporee", startsAt: new Date("2027-02-19T21:00:00.000Z"), endsAt: new Date("2027-02-21T17:00:00.000Z"), timezone: "America/Chicago", location: "Camp", supportContact: "office@example.test", billingMode: "ATTENDEE_PAY", paymentInstructionVersions: [] },
    attendees: [{ id: "attendee-1", profileSnapshot: { firstName: "Avery", lastName: "Example" }, person: { firstName: "Avery", lastName: "Example" } }],
    payments: [],
    waitlistEntry: null,
    groupRegistration: null,
  };
}

function transitionFixture(paused: boolean) {
  const upsert = vi.fn(async ({ create }: { create: Record<string, unknown> }) => ({ id: `message-${upsert.mock.calls.length}`, status: create.status }));
  const tx = {
    ...baseTx(paused),
    eventMessageTemplate: { findUnique: vi.fn().mockResolvedValue(null) },
    registration: { findFirst: vi.fn().mockResolvedValue(registrationRow()) },
    adminAlertFeedItem: { createMany: vi.fn(async () => ({ count: 1 })) },
    messageOutbox: { upsert },
  };
  return { tx, upsert };
}

const created = (upsert: ReturnType<typeof vi.fn>) => upsert.mock.calls.map(([call]) => (call as { create: Record<string, unknown> }).create);

beforeEach(() => vi.clearAllMocks());

describe("registration messages wait for the PDF, made after the commit (#1082)", () => {
  it("queues the confirmation and the staff copy held and without an attachment: the PDF is not made inside the transaction", async () => {
    const { tx, create } = submitFixture(false);
    await enqueuePublicRegistrationMessages(tx as never, submitInput({ holdForRegistrationPdf: true }));
    const rows = create.mock.calls.map(([call]) => call.data);
    expect(rows.map((row) => row.recipientKind)).toEqual(expect.arrayContaining(["INTERNAL", "REGISTRANT"]));
    for (const row of rows) {
      expect(row).not.toHaveProperty("attachmentId");
      expect((row.availableAt as Date).getTime()).toBeGreaterThan(Date.now() + 60_000);
      // The line saying a PDF is attached is added only once the file exists.
      expect(String(row.bodyTextSnapshot)).not.toContain("PDF");
    }
  });

  it("holds nothing when the PDF is not expected, so the messages go exactly as before", async () => {
    const { tx, create } = submitFixture(false);
    await enqueuePublicRegistrationMessages(tx as never, submitInput());
    for (const [call] of create.mock.calls) {
      expect(call.data).not.toHaveProperty("availableAt");
      expect(call.data).not.toHaveProperty("attachmentId");
    }
  });

  it("a paused event still queues the messages, but as capture only: nothing is marked for real delivery", async () => {
    const paused = submitFixture(true);
    await enqueuePublicRegistrationMessages(paused.tx as never, submitInput({ holdForRegistrationPdf: true }));
    for (const [call] of paused.create.mock.calls) {
      expect(call.data.metadata).toMatchObject({ deliveryMode: "LOCAL_CAPTURE", realDelivery: false });
    }
    const live = submitFixture(false);
    await enqueuePublicRegistrationMessages(live.tx as never, submitInput({ holdForRegistrationPdf: true }));
    for (const [call] of live.create.mock.calls) {
      expect(call.data.metadata).toMatchObject({ deliveryMode: "EXTERNAL_EMAIL", realDelivery: true });
    }
  });
});

describe("the Updated re-send (#1082)", () => {
  it("sends the registrant's updated confirmation with the new PDF and a line that it replaces the old one", async () => {
    const { tx, upsert } = transitionFixture(false);
    await enqueueRegistrationUpdatedMessage(tx as never, {
      eventId: "event-1",
      registrationId: "registration-1",
      correlationId: "correlation-1",
      transitionKey: "registration-amendment:op-1",
      changeCategory: "REGISTRATION_DETAILS",
      attachmentId: "attachment-2",
      leadNote: REGISTRANT_UPDATED_PDF_NOTE,
    });
    const [message] = created(upsert);
    expect(message).toMatchObject({ templateKey: "REGISTRATION_UPDATED", recipientKind: "REGISTRANT", recipientEmail: "pat@example.test", attachmentId: "attachment-2" });
    expect(String(message!.bodyTextSnapshot).startsWith(REGISTRANT_UPDATED_PDF_NOTE)).toBe(true);
  });

  it("re-sends the staff copy marked Updated to each distinct team address, with the new PDF", async () => {
    const { tx, upsert } = transitionFixture(false);
    const result = await queueStaffUpdatedRegistrationCopies(tx as never, {
      eventId: "event-1",
      registrationId: "registration-1",
      attachmentId: "attachment-2",
      changeKey: "registration-amendment:op-1",
      correlationId: "correlation-1",
      staffCopyEnabled: true,
    });
    const rows = created(upsert);
    expect(rows.map((row) => row.recipientEmail)).toEqual(["team@example.test", "second@example.test"]);
    expect(result.messageIds).toHaveLength(2);
    expect(new Set(rows.map((row) => row.idempotencyKey)).size).toBe(2);
    for (const row of rows) {
      expect(row).toMatchObject({ templateKey: "INTERNAL_NEW_REGISTRATION", recipientKind: "INTERNAL", attachmentId: "attachment-2" });
      expect(String(row.subjectSnapshot).startsWith("Updated: New registration")).toBe(true);
      expect(String(row.bodyTextSnapshot).startsWith(STAFF_UPDATED_PDF_NOTE)).toBe(true);
      expect(String(row.bodyTextSnapshot)).toContain("# Updated registration for Synthetic Camporee");
      expect(String(row.bodyTextSnapshot)).not.toContain("# New registration");
    }
  });

  it("a retried change queues the same keys, so nothing is sent twice", async () => {
    const first = transitionFixture(false);
    const second = transitionFixture(false);
    const input = { eventId: "event-1", registrationId: "registration-1", attachmentId: "attachment-2", changeKey: "registration-amendment:op-1", correlationId: "correlation-1", staffCopyEnabled: true };
    await queueStaffUpdatedRegistrationCopies(first.tx as never, input);
    await queueStaffUpdatedRegistrationCopies(second.tx as never, input);
    expect(created(first.upsert).map((row) => row.idempotencyKey)).toEqual(created(second.upsert).map((row) => row.idempotencyKey));
  });

  it("sends no staff copy when the staff-copy switch is off", async () => {
    const { tx, upsert } = transitionFixture(false);
    const result = await queueStaffUpdatedRegistrationCopies(tx as never, { eventId: "event-1", registrationId: "registration-1", attachmentId: "attachment-2", changeKey: "registration-amendment:op-1", correlationId: "correlation-1", staffCopyEnabled: false });
    expect(result).toEqual({ messageIds: [], pendingMessageIds: [] });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("a paused event captures the updated messages and sends nothing", async () => {
    const { tx, upsert } = transitionFixture(true);
    await queueStaffUpdatedRegistrationCopies(tx as never, { eventId: "event-1", registrationId: "registration-1", attachmentId: "attachment-2", changeKey: "registration-amendment:op-1", correlationId: "correlation-1", staffCopyEnabled: true });
    await enqueueRegistrationUpdatedMessage(tx as never, { eventId: "event-1", registrationId: "registration-1", correlationId: "correlation-1", transitionKey: "registration-amendment:op-1", changeCategory: "REGISTRATION_DETAILS", attachmentId: "attachment-2" });
    for (const row of created(upsert)) {
      expect(row.metadata).toMatchObject({ deliveryMode: "LOCAL_CAPTURE", realDelivery: false });
    }
  });
});
