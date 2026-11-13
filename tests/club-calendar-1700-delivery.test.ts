import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/modules/communications/effective-delivery", async () => (await import("./support/effective-delivery-double")).effectiveDeliveryDouble);

vi.mock("server-only", () => ({}));
vi.mock("@/modules/lodging/message-currency", () => ({ lodgingMessageStaleReason: vi.fn() }));
const obsolete = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@/modules/club-calendar/reminders", () => ({ clubCalendarReminderCheck: obsolete.check }));

import { processExternalEmailQueue } from "@/modules/communications/email-delivery";
import { EMAIL_HEADER_RULES, EMAIL_WHY_LINES } from "@/modules/communications/email-layout";

/**
 * The club calendar reminder at the delivery step (#1700): re-checked right before the provider call, and it honours an
 * opt-out of ALL IMAdventist announcements (never an event-scoped one), with its own audit action and note. Synthetic
 * rows, fake database and fake provider, so nothing is sent anywhere. The harness follows the club registration
 * reminder delivery test (#164).
 */

const configuration = { apiKey: "re_test_only", apiUrl: "https://api.resend.test" };
const now = () => new Date("2026-11-10T15:00:00.000Z");

type Row = Record<string, unknown> & { id: string; status: string };

function store() {
  const message: Row = {
    id: "message-1",
    eventId: null,
    accountUserId: null,
    accountAttendeeId: null,
    templateKey: "CLUB_CALENDAR_REMINDER",
    registrationId: null,
    recipientKind: "ACCOUNT",
    recipientEmail: "director@example.test",
    senderNameSnapshot: "IMAdventist",
    senderEmailSnapshot: "events@imsda.org",
    replyToEmailSnapshot: null,
    subjectSnapshot: "Test Pathfinders: Outing on Thursday, November 12, 2026: Canoe trip",
    bodyTextSnapshot: "Hello,\n\nAn outing is coming up on the Test Pathfinders calendar.",
    bodyHtmlSnapshot: null,
    metadata: { trigger: "CLUB_CALENDAR_REMINDER", organizationId: "club-1", itemId: "item-1", itemDate: "2026-11-12" },
    status: "PENDING",
    attemptCount: 0,
    availableAt: new Date("2026-11-10T15:00:00.000Z"),
    lockedAt: null,
    lockToken: null,
  };
  const auditRows: Array<Record<string, unknown>> = [];
  const messageOutbox = {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => (message.status === "PENDING" && (message.availableAt as Date) <= now() ? { ...message, attachment: null, files: [] } : null)),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (where.id !== message.id || (where.status && where.status !== message.status)) return { count: 0 };
      if ("lockToken" in where && where.lockToken !== message.lockToken) return { count: 0 };
      Object.assign(message, data);
      return { count: 1 };
    }),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(message, data)),
  };
  const tx = {
    messageOutbox,
    messageDeliveryAttempt: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      findFirst: vi.fn(async () => null),
      aggregate: vi.fn(async () => ({ _max: { attemptNumber: null } })),
    },
    messageProviderEvent: { updateMany: vi.fn(async () => ({ count: 0 })), findFirst: vi.fn(async () => null) },
    clubFormLink: { updateMany: vi.fn(async () => ({ count: 0 })) },
    healthRecordLink: { updateMany: vi.fn(async () => ({ count: 0 })) },
  };
  const prisma = {
    eventMessageSettings: { findUnique: vi.fn(async () => ({ deliveryMode: "EXTERNAL_EMAIL", senderEmail: "events@imsda.org" })) },
    messageOutbox,
    invoiceDeliveryRecipient: { findFirst: vi.fn(async () => null) },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { auditRows.push(data); }) },
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
  };
  return { prisma, message, auditRows };
}

type Options = { optOut?: "EVENT" | "ALL" | null };

function run(state: ReturnType<typeof store>, options: Options = {}) {
  const sendEmail = vi.fn(async (...args: [Record<string, unknown>]) => (void args, { provider: "RESEND" as const, providerMessageId: "provider-1" }));
  const findAnnouncementOptOut = vi.fn(async (_email: string, eventId: string) => {
    // An event-less message asks with an empty event id, so only a global opt-out can match it.
    expect(eventId).toBe("");
    return options.optOut === "ALL" ? "ALL" as const : null;
  });
  const done = processExternalEmailQueue("event-1", {
    dependencies: {
      configuration,
      now,
      prisma: state.prisma as never,
      sendEmail: sendEmail as never,
      findAnnouncementOptOut,
      isAnnouncementEssential: vi.fn(async () => false),
      issueUnsubscribeToken: vi.fn(async () => { throw new Error("an event-less reminder has no event-scoped unsubscribe link"); }),
      prepareBodyText: async (input: { bodyText: string; bodyHtml?: string | null }) => ({ bodyText: input.bodyText, bodyHtml: input.bodyHtml ?? null, revokeOnDefinitiveFailure: vi.fn(async () => undefined) }),
    },
  });
  return { sendEmail, findAnnouncementOptOut, done };
}

beforeEach(() => {
  obsolete.check.mockReset();
  obsolete.check.mockResolvedValue(null);
});

const NOTE = "The calendar item was deleted, moved or has passed, or reminders were turned off, or the recipient no longer has a club role, so the reminder was not sent.";

describe("club calendar reminders at delivery (#1700)", () => {
  it("sends a wanted reminder, checked against this message's own address and item", async () => {
    const state = store();
    const { sendEmail, done } = run(state);
    expect((await done).sentIds).toEqual(["message-1"]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(obsolete.check).toHaveBeenCalledWith(expect.objectContaining({ recipientEmail: "director@example.test", metadata: expect.objectContaining({ itemId: "item-1", itemDate: "2026-11-12" }) }), expect.any(Date));
  });

  it("cancels an obsolete reminder with a plain note and an audit entry that names ids only", async () => {
    obsolete.check.mockResolvedValueOnce({ kind: "OBSOLETE", note: NOTE });
    const state = store();
    const { sendEmail, done } = run(state);
    await done;
    expect(sendEmail).not.toHaveBeenCalled();
    expect(state.message.status).toBe("CANCELLED");
    expect(state.message.lastError).toBe(NOTE);
    expect(state.auditRows).toEqual([expect.objectContaining({ action: "CLUB_CALENDAR_REMINDER_CANCELLED", metadata: { messageId: "message-1", templateKey: "CLUB_CALENDAR_REMINDER" } })]);
    expect(JSON.stringify(state.auditRows)).not.toMatch(/director@example\.test|Canoe/);
  });

  it("checks again just before the provider call, so an item deleted while the body was prepared is not reminded", async () => {
    obsolete.check.mockResolvedValueOnce(null).mockResolvedValueOnce({ kind: "OBSOLETE", note: NOTE });
    const state = store();
    const { sendEmail, done } = run(state);
    await done;
    expect(obsolete.check).toHaveBeenCalledTimes(2);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(state.message.status).toBe("CANCELLED");
  });

  it("fails closed when the check itself fails: nothing is sent and the message is retried", async () => {
    obsolete.check.mockRejectedValueOnce(new Error("database unavailable"));
    const state = store();
    const { sendEmail, done } = run(state);
    await done;
    expect(sendEmail).not.toHaveBeenCalled();
    expect(state.message.status).toBe("PENDING");
    expect(state.message.attemptCount).toBe(1);
  });

  it("does not send to an address that opted out of ALL announcements, with its own audit action and note", async () => {
    const state = store();
    const { sendEmail, findAnnouncementOptOut, done } = run(state, { optOut: "ALL" });
    await done;
    expect(findAnnouncementOptOut).toHaveBeenCalledWith("director@example.test", "");
    expect(sendEmail).not.toHaveBeenCalled();
    expect(state.message.status).toBe("SUPPRESSED");
    expect(String(state.message.lastError)).toMatch(/opted out of all IMAdventist announcements.*club calendar reminder was not sent/i);
    expect(state.auditRows).toEqual([expect.objectContaining({ action: "CLUB_CALENDAR_REMINDER_SKIPPED_OPTED_OUT", metadata: { messageId: "message-1", scope: "ALL" } })]);
    expect(JSON.stringify(state.auditRows)).not.toContain("director@example.test");
  });

  it("is not stopped by an opt-out of some event's announcements: only the global opt-out applies", async () => {
    const state = store();
    const { sendEmail, done } = run(state, { optOut: "EVENT" });
    expect((await done).sentIds).toEqual(["message-1"]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("has a club header and a why line", () => {
    expect(EMAIL_HEADER_RULES.CLUB_CALENDAR_REMINDER).toBe("club");
    expect(EMAIL_WHY_LINES.CLUB_CALENDAR_REMINDER).toMatch(/^You got this because/);
  });
});
