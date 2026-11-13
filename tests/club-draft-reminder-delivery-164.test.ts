import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/modules/communications/effective-delivery", async () => (await import("./support/effective-delivery-double")).effectiveDeliveryDouble);

vi.mock("server-only", () => ({}));
vi.mock("@/modules/lodging/message-currency", () => ({ lodgingMessageStaleReason: vi.fn() }));
const obsolete = vi.hoisted(() => ({ reason: vi.fn() }));
vi.mock("@/modules/club-registrations/draft-reminders", () => ({ clubDraftReminderCheck: obsolete.reason }));

import { resetServerEnvCache } from "@/lib/env";
import { processExternalEmailQueue } from "@/modules/communications/email-delivery";
import { deriveUnsubscribeToken } from "@/modules/communications/email-preferences";

/**
 * The reminder to finish an unsubmitted club registration at the delivery step (#164): re-checked right before the
 * provider call, honours the announcement opt-out, and carries the unsubscribe link. Synthetic rows, fake database and
 * fake provider, so nothing is sent anywhere. The harness follows the announcement opt-out delivery test (#838).
 */

const configuration = { apiKey: "re_test_only", apiUrl: "https://api.resend.test" };
const now = () => new Date("2026-07-23T12:00:00.000Z");

type Row = Record<string, unknown> & { id: string; status: string };

function store(overrides: Partial<Row> = {}) {
  const message: Row = {
    id: "message-1",
    eventId: "event-1",
    accountUserId: null,
    accountAttendeeId: null,
    templateKey: "CLUB_DRAFT_REMINDER",
    registrationId: null,
    recipientKind: "CLUB_DIRECTOR",
    recipientEmail: "director@example.test",
    senderNameSnapshot: "IMAdventist",
    senderEmailSnapshot: "registration@imsda.org",
    replyToEmailSnapshot: null,
    subjectSnapshot: "Synthetic Club: finish your registration for Synthetic Camporee",
    bodyTextSnapshot: "Hello Avery,\n\nSynthetic Club has started a registration.",
    bodyHtmlSnapshot: null,
    metadata: { trigger: "CLUB_DRAFT_REMINDER", draftIds: ["draft-1"], organizationId: "org-1", attempts: [1] },
    status: "PENDING",
    attemptCount: 0,
    availableAt: new Date("2026-07-23T12:00:00.000Z"),
    lockedAt: null,
    lockToken: null,
    ...overrides,
  };
  const auditRows: Array<Record<string, unknown>> = [];
  const attempts: Array<Record<string, unknown>> = [];
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
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { attempts.push(data); return data; }),
      findFirst: vi.fn(async () => null),
      aggregate: vi.fn(async () => ({ _max: { attemptNumber: null } })),
    },
    messageProviderEvent: { updateMany: vi.fn(async () => ({ count: 0 })), findFirst: vi.fn(async () => null) },
    clubFormLink: { updateMany: vi.fn(async () => ({ count: 0 })) },
    healthRecordLink: { updateMany: vi.fn(async () => ({ count: 0 })) },
  };
  const prisma = {
    eventMessageSettings: { findUnique: vi.fn(async () => ({ deliveryMode: "EXTERNAL_EMAIL", senderEmail: "registration@imsda.org" })) },
    messageOutbox,
    invoiceDeliveryRecipient: { findFirst: vi.fn(async () => null) },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { auditRows.push(data); }) },
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
  };
  return { prisma, message, auditRows, attempts };
}




type Options = {
  optOut?: "EVENT" | "ALL" | null;
  essential?: boolean;
  lookup?: "missing" | "throws";
  sendEmail?: ReturnType<typeof vi.fn>;
};

function dependenciesFor(state: ReturnType<typeof store>, options: Options, sendEmail: ReturnType<typeof vi.fn>) {
  const revoke = vi.fn(async () => undefined);
  return {
    configuration,
    now,
    prisma: state.prisma as never,
    sendEmail: sendEmail as never,
    ...(options.lookup === "missing"
      ? {}
      : { findAnnouncementOptOut: options.lookup === "throws" ? vi.fn(async () => { throw new Error("database unavailable"); }) : vi.fn(async () => options.optOut ?? null) }),
    isAnnouncementEssential: vi.fn(async () => options.essential === true),
    issueUnsubscribeToken: vi.fn(async (email: string, eventId: string) => deriveUnsubscribeToken({ email, eventId })),
    // The prepared body carries a revocation for its private link; the spy shows when delivery withdraws it.
    revoke,
    prepareBodyText: async (input: { bodyText: string; bodyHtml?: string | null }) => ({
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml ?? null,
      revokeOnDefinitiveFailure: revoke,
    }),
  };
}

function run(state: ReturnType<typeof store>, options: Options = {}) {
  const sendEmail = options.sendEmail ?? vi.fn(async (...args: [Record<string, unknown>]) => (void args, { provider: "RESEND" as const, providerMessageId: "provider-1" }));
  return { sendEmail, done: processExternalEmailQueue("event-1", { dependencies: dependenciesFor(state, options, sendEmail) }) };
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnvCache();
});

beforeEach(() => {
  obsolete.reason.mockReset();
  obsolete.reason.mockResolvedValue(null);
});

const NOTE = "The draft was submitted, removed or expired, or reminders were turned off, so the reminder was not sent.";
const OBSOLETE = { kind: "OBSOLETE", note: NOTE };

describe("club registration reminders at delivery (#164)", () => {
  it("cancels a reminder whose draft was submitted or removed, with a plain note and an audit entry that names ids only", async () => {
    obsolete.reason.mockResolvedValueOnce(OBSOLETE);
    const state = store();
    const { sendEmail, done } = run(state);
    const result = await done;
    expect(sendEmail).not.toHaveBeenCalled();
    expect(result.sentIds).toEqual([]);
    expect(state.message.status).toBe("CANCELLED");
    expect(state.message.lastError).toBe(NOTE);
    expect(state.auditRows).toEqual([expect.objectContaining({ action: "CLUB_DRAFT_REMINDER_CANCELLED", metadata: { messageId: "message-1", templateKey: "CLUB_DRAFT_REMINDER" } })]);
    expect(JSON.stringify(state.auditRows)).not.toContain("director@example.test");
    // The check is asked about this message's own event, address and draft.
    expect(obsolete.reason).toHaveBeenCalledWith(expect.objectContaining({ eventId: "event-1", recipientEmail: "director@example.test", metadata: expect.objectContaining({ draftIds: ["draft-1"] }) }), expect.any(Date));
  });

  it("fails closed when the check itself fails: nothing is sent and the message is retried", async () => {
    obsolete.reason.mockRejectedValueOnce(new Error("database unavailable"));
    const state = store();
    const { sendEmail, done } = run(state);
    await done;
    expect(sendEmail).not.toHaveBeenCalled();
    expect(state.message.status).toBe("PENDING");
    expect(state.message.attemptCount).toBe(1);
  });

  it.each(["EVENT", "ALL"] as const)("does not send to an address that opted out for %s, with its own audit action and note", async (scope) => {
    const state = store();
    const { sendEmail, done } = run(state, { optOut: scope });
    await done;
    expect(sendEmail).not.toHaveBeenCalled();
    expect(state.message.status).toBe("SUPPRESSED");
    expect(String(state.message.lastError)).toMatch(/opted out.*registration reminder was not sent/i);
    expect(state.auditRows).toEqual([expect.objectContaining({ action: "CLUB_DRAFT_REMINDER_SKIPPED_OPTED_OUT", metadata: { messageId: "message-1", scope } })]);
    expect(JSON.stringify(state.auditRows)).not.toContain("director@example.test");
  });

  it("sends a wanted reminder with the unsubscribe link, the reminder footer wording and the one-click header", async () => {
    vi.stubEnv("APP_BASE_URL", "https://events.imsda.test");
    resetServerEnvCache();
    const state = store();
    const { sendEmail, done } = run(state);
    expect((await done).sentIds).toEqual(["message-1"]);
    const sent = sendEmail.mock.calls[0][0] as { listUnsubscribe: { url: string }; bodyText: string };
    const token = deriveUnsubscribeToken({ email: "director@example.test", eventId: "event-1" });
    expect(sent.listUnsubscribe.url).toBe(`https://events.imsda.test/api/public/unsubscribe/${token}`);
    expect(sent.bodyText).toContain(`To stop getting reminders and announcements for this event, or change what you get: https://events.imsda.test/unsubscribe/${token}`);
    expect(state.message.bodyTextSnapshot).not.toContain("unsubscribe");
  });

  it("checks again just before the provider call, so a draft submitted while the body was prepared is not reminded", async () => {
    obsolete.reason.mockResolvedValueOnce(null).mockResolvedValueOnce(OBSOLETE);
    const state = store();
    const { sendEmail, done } = run(state);
    await done;
    expect(obsolete.reason).toHaveBeenCalledTimes(2);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(state.message.status).toBe("CANCELLED");
  });

  it("puts a reminder back for the morning, without using up an attempt, when it is outside the send hours", async () => {
    const until = new Date("2026-07-24T14:00:00.000Z");
    obsolete.reason.mockResolvedValueOnce({ kind: "WAIT", until, note: "Waiting for the morning: reminders go out between the send hours only." });
    const state = store();
    const { sendEmail, done } = run(state);
    await done;
    expect(sendEmail).not.toHaveBeenCalled();
    expect(state.message).toMatchObject({ status: "PENDING", availableAt: until, attemptCount: 0, lockToken: null });
    expect(String(state.message.lastError)).toMatch(/morning/);
    expect(state.auditRows).toEqual([]);
  });
});
