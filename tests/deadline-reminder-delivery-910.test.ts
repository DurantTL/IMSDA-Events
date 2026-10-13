import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/lodging/message-currency", () => ({ lodgingMessageStaleReason: vi.fn() }));

import { resetServerEnvCache } from "@/lib/env";
import { processAccountEmailQueue } from "@/modules/communications/email-delivery";

/**
 * Deadline reminders at the delivery step (#910): an opt-out of ALL announcements recorded after staff clicked Send
 * (while the reminder waited in the queue) is still honoured, ending the row SUPPRESSED. A synthetic outbox row goes
 * through the real delivery loop with a fake database and a fake provider.
 */
const configuration = { apiKey: "re_test_only", apiUrl: "https://api.resend.test" };
const now = () => new Date("2026-12-03T12:00:00.000Z");

type Row = Record<string, unknown> & { id: string; status: string };

function store(templateKey = "DEADLINE_REMINDER") {
  const message: Row = {
    id: "reminder-1",
    eventId: null,
    accountUserId: null,
    accountAttendeeId: null,
    templateKey,
    registrationId: null,
    recipientEmail: "director@example.test",
    senderNameSnapshot: "IMSDA Events",
    senderEmailSnapshot: "events@example.test",
    replyToEmailSnapshot: null,
    subjectSnapshot: "Deadline reminder: Reports Due (December 5, 2026)",
    bodyTextSnapshot: "Hello,\n\nA friendly reminder.",
    bodyHtmlSnapshot: null,
    metadata: { trigger: "DEADLINE_REMINDER", deadlineReminderBatchId: "batch-1" },
    status: "PENDING",
    attemptCount: 0,
    availableAt: new Date("2026-12-03T12:00:00.000Z"),
    lockedAt: null,
    lockToken: null,
  };
  const auditRows: Array<Record<string, unknown>> = [];
  const messageOutbox = {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => (message.status === "PENDING" ? { ...message, attachment: null, files: [] } : null)),
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
    messageDeliveryAttempt: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data), findFirst: vi.fn(async () => null), aggregate: vi.fn(async () => ({ _max: { attemptNumber: null } })) },
    messageProviderEvent: { updateMany: vi.fn(async () => ({ count: 0 })), findFirst: vi.fn(async () => null) },
    clubFormLink: { updateMany: vi.fn(async () => ({ count: 0 })) },
    healthRecordLink: { updateMany: vi.fn(async () => ({ count: 0 })) },
  };
  const prisma = {
    messageOutbox,
    invoiceDeliveryRecipient: { findFirst: vi.fn(async () => null) },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { auditRows.push(data); }) },
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
  };
  return { prisma, message, auditRows };
}

function run(state: ReturnType<typeof store>, lookup: (email: string, eventId: string) => Promise<"EVENT" | "ALL" | null>) {
  const sendEmail = vi.fn(async () => ({ provider: "RESEND" as const, providerMessageId: "provider-1" }));
  const done = processAccountEmailQueue({
    dependencies: {
      configuration,
      now,
      prisma: state.prisma as never,
      sendEmail: sendEmail as never,
      findAnnouncementOptOut: lookup,
      prepareBodyText: async (input: { bodyText: string; bodyHtml?: string | null }) => ({ bodyText: input.bodyText, bodyHtml: input.bodyHtml ?? null }),
    },
  });
  return { sendEmail, done };
}

beforeEach(() => {
  vi.stubEnv("ACCOUNT_EMAIL_SENDER_ADDRESS", "events@example.test");
  resetServerEnvCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnvCache();
});

describe("deadline reminders and opt-outs at delivery (#910)", () => {
  it("does not send to an address that opted out of all announcements after Send, and records why", async () => {
    const state = store();
    const lookup = vi.fn(async () => "ALL" as const);
    const { sendEmail, done } = run(state, lookup);
    expect((await done).sentIds).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(state.message.status).toBe("SUPPRESSED");
    expect(String(state.message.lastError)).toMatch(/opted out of all .*deadline reminder was not sent/i);
    // No event: only an opt-out of everything can match, never one for a particular event.
    expect(lookup).toHaveBeenCalledWith("director@example.test", "");
    expect(state.auditRows).toEqual([expect.objectContaining({ action: "DEADLINE_REMINDER_SKIPPED_OPTED_OUT", metadata: { messageId: "reminder-1", scope: "ALL" } })]);
    expect(JSON.stringify(state.auditRows)).not.toContain("director@example.test");
  });

  it.each(["CLUB_INVITE", "LOCATION_WAITLIST_DIGEST"])("an opt-out of all announcements does not stop other event-less mail (%s)", async (templateKey) => {
    const state = store(templateKey);
    const lookup = vi.fn(async () => "ALL" as const);
    const { sendEmail, done } = run(state, lookup);
    expect((await done).sentIds).toEqual(["reminder-1"]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(lookup).not.toHaveBeenCalled();
    expect(state.message.status).not.toBe("SUPPRESSED");
  });

  it("sends when nobody opted out", async () => {
    const state = store();
    const { sendEmail, done } = run(state, async () => null);
    expect((await done).sentIds).toEqual(["reminder-1"]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("does not send when the opt-out cannot be checked (fails closed, retried later)", async () => {
    const state = store();
    const { sendEmail, done } = run(state, async () => { throw new Error("database unavailable"); });
    expect((await done).sentIds).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(state.message.status).not.toBe("SENT");
  });
});
