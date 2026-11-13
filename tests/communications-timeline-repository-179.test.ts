import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  registrationFindFirst: vi.fn(),
  messageFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    registration: { findFirst: mocks.registrationFindFirst },
    messageOutbox: { findMany: mocks.messageFindMany },
  }),
}));

import { loadRegistrationTimeline } from "@/modules/communications/timeline-repository";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_1",
    templateKey: "REGISTRATION_CONFIRMATION_PAID",
    recipientKind: "REGISTRANT",
    recipientEmail: "sam@example.test",
    recipientName: "Sam Rivera",
    senderNameSnapshot: "IMSDA Events",
    replyToEmailSnapshot: "office@example.test",
    subjectSnapshot: "You are confirmed",
    bodyTextSnapshot: "See you there.",
    status: "SENT",
    providerDeliveryStatus: "DELIVERED",
    attemptCount: 1,
    retryOfMessageId: null,
    capturedAt: null,
    sentAt: new Date("2026-06-01T00:05:00.000Z"),
    deliveredAt: new Date("2026-06-01T00:06:00.000Z"),
    failedAt: null,
    lastError: null,
    createdAt: new Date("2026-06-01T00:05:00.000Z"),
    templateVersion: { versionNumber: 3 },
    retries: [],
    scheduledEmailRecipient: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.registrationFindFirst.mockResolvedValue({ id: "reg_1" });
});

describe("registration communication timeline (#179)", () => {
  it("reads only this event's messages for this registration, newest first, without test or account email", async () => {
    mocks.messageFindMany.mockResolvedValue([]);
    await loadRegistrationTimeline({ eventId: "evt_1", registrationId: "reg_1", permissions: ["VIEW_SENSITIVE_DATA"] });
    const args = mocks.messageFindMany.mock.calls[0]![0];
    expect(args.where).toEqual({ eventId: "evt_1", registrationId: "reg_1", recipientKind: { notIn: ["TEST", "ACCOUNT"] } });
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(args.take).toBe(51);
    expect(mocks.registrationFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "reg_1", eventId: "evt_1" } }));
  });

  it("answers null for a registration that is not in this event", async () => {
    mocks.registrationFindFirst.mockResolvedValue(null);
    expect(await loadRegistrationTimeline({ eventId: "evt_other", registrationId: "reg_1", permissions: [] })).toBeNull();
    expect(mocks.messageFindMany).not.toHaveBeenCalled();
  });

  it("identifies type, template version, recipient role, sender, batch and delivery", async () => {
    mocks.messageFindMany.mockResolvedValue([
      row({ recipientKind: "BILLING_CONTACT", scheduledEmailRecipient: { batch: { id: "b1", name: "Two weeks out" } }, attemptCount: 2 }),
      row({ id: "msg_2", templateVersion: null, templateKey: "CUSTOM_MESSAGE", recipientKind: "INTERNAL" }),
    ]);
    const timeline = await loadRegistrationTimeline({ eventId: "evt_1", registrationId: "reg_1", permissions: [] });
    expect(timeline!.rows[0]).toMatchObject({
      messageType: "Registration Confirmation Paid",
      templateVersionNumber: 3,
      templateVersionLabel: "Version 3",
      recipientRole: "Billing contact",
      senderName: "IMSDA Events",
      replyTo: "office@example.test",
      batch: { id: "b1", name: "Two weeks out" },
      attemptCount: 2,
      status: "SENT",
      providerDeliveryStatus: "DELIVERED",
      bodyText: "See you there.",
    });
    expect(timeline!.rows[1]).toMatchObject({ templateVersionNumber: null, templateVersionLabel: "Written for this send", recipientRole: "Staff notice", batch: null });
  });

  it("keeps health subject, text and error out of the serialized data without the permission", async () => {
    mocks.messageFindMany.mockResolvedValue([
      row({ id: "msg_h", templateKey: "HEALTH_RECORD_LINK", subjectSnapshot: "Allergy form for Sam", bodyTextSnapshot: "peanut allergy details", lastError: "rejected: peanut" }),
      row({ id: "msg_o" }),
    ]);
    const timeline = await loadRegistrationTimeline({ eventId: "evt_1", registrationId: "reg_1", permissions: ["VIEW_SENSITIVE_DATA", "MANAGE_COMMUNICATIONS"] });
    const health = timeline!.rows[0]!;
    expect(health).toMatchObject({ subject: "Health record message", bodyText: null, contentWithheld: true, lastError: null, messageType: "Health Record Link", recipientRole: "Registrant", status: "SENT" });
    expect(JSON.stringify(timeline!.rows[0])).not.toMatch(/Allergy|peanut/);
    expect(timeline!.rows[1]).toMatchObject({ bodyText: "See you there.", contentWithheld: false });
  });

  it("shows health text to a viewer with the health permission", async () => {
    mocks.messageFindMany.mockResolvedValue([row({ templateKey: "HEALTH_RECORD_LINK", subjectSnapshot: "Health form", bodyTextSnapshot: "Open your link" })]);
    const timeline = await loadRegistrationTimeline({ eventId: "evt_1", registrationId: "reg_1", permissions: ["VIEW_HEALTH_INFORMATION"] });
    expect(timeline!.rows[0]).toMatchObject({ subject: "Health form", bodyText: "Open your link", contentWithheld: false });
  });

  it("links a resend and its original both ways, and does not change the original's fields", async () => {
    mocks.messageFindMany.mockResolvedValue([
      row({ id: "msg_copy", retryOfMessageId: "msg_original", createdAt: new Date("2026-06-02T00:05:00.000Z") }),
      row({ id: "msg_original", retries: [{ id: "msg_copy" }] }),
    ]);
    const timeline = await loadRegistrationTimeline({ eventId: "evt_1", registrationId: "reg_1", permissions: [] });
    const [copy, original] = timeline!.rows;
    expect(copy).toMatchObject({ retryOfMessageId: "msg_original", resentByMessageIds: [] });
    expect(original).toMatchObject({ retryOfMessageId: null, resentByMessageIds: ["msg_copy"], status: "SENT", subject: "You are confirmed" });
    expect(mocks.messageFindMany.mock.calls[0]![0]).not.toHaveProperty("data");
  });

  it("caps at 50 and says when more exist", async () => {
    mocks.messageFindMany.mockResolvedValue(Array.from({ length: 51 }, (_, index) => row({ id: `msg_${index}` })));
    const timeline = await loadRegistrationTimeline({ eventId: "evt_1", registrationId: "reg_1", permissions: [] });
    expect(timeline!.rows).toHaveLength(50);
    expect(timeline).toMatchObject({ hasMore: true, limit: 50 });
  });
});
