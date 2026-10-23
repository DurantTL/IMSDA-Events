import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The real suppression decision, with the rest of effective-delivery stood in for (these tests are about the recipient).
vi.mock("@/modules/communications/effective-delivery", async () => {
  const double = (await import("./support/effective-delivery-double")).effectiveDeliveryDouble;
  // The real suppression decision, loaded when called rather than while the mock is built (the real module reaches the
  // delivery worker through its own imports). The rest of effective-delivery is stood in for: these tests are about the recipient.
  return {
    ...double,
    checkRecipientDeliverable: async (...args: unknown[]) => {
      const real = await vi.importActual<typeof import("@/modules/communications/effective-delivery")>("@/modules/communications/effective-delivery");
      return (real.checkRecipientDeliverable as (...inner: unknown[]) => Promise<unknown>)(...args);
    },
  };
});

import { resetServerEnvCache } from "@/lib/env";
import { processAccountEmailQueue, processExternalEmailQueue } from "@/modules/communications/email-delivery";

type Message = Record<string, unknown> & { id: string; status: string; recipientEmail: string; lockToken: string | null };

function fakeStore(options: { recipientEmail?: string; suppressions?: Array<{ normalizedEmail: string; reason: "BOUNCE" | "COMPLAINT"; suppressedAt: Date; reenabledAt: Date | null }>; lookupFails?: boolean; eventId?: string | null; templateKey?: string }) {
  const message: Message = {
    id: "message-1",
    eventId: options.eventId === undefined ? "event-1" : options.eventId,
    accountUserId: null,
    accountAttendeeId: null,
    templateKey: options.templateKey ?? "REGISTRATION_CONFIRMATION_PAID",
    registrationId: "registration-1",
    recipientEmail: options.recipientEmail ?? "attendee@example.test",
    senderNameSnapshot: "IMSDA Events",
    senderEmailSnapshot: "registration@imsda.org",
    replyToEmailSnapshot: null,
    subjectSnapshot: "Registration received",
    bodyTextSnapshot: "Your registration is saved.",
    bodyHtmlSnapshot: null,
    status: "PENDING",
    attemptCount: 0,
    availableAt: new Date("2026-10-23T11:00:00Z"),
    createdAt: new Date("2026-10-23T10:00:00Z"),
    lockedAt: null,
    lockToken: null,
  };
  const audits: Array<Record<string, unknown>> = [];
  const attempts: Array<Record<string, unknown>> = [];
  const messageOutbox = {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => (message.status === "PENDING" && (message.availableAt as Date) <= new Date("2026-10-23T12:00:00Z") ? { ...message, attachment: null, files: [] } : null)),
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
    messageProviderEvent: { updateMany: vi.fn(async () => ({ count: 0 })), findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    clubFormLink: { updateMany: vi.fn(async () => ({ count: 1 })) },
    healthRecordLink: { updateMany: vi.fn(async () => ({ count: 0 })) },
  };
  const emailAddressSuppression = {
    findFirst: vi.fn(async ({ where }: { where: { normalizedEmail: string; reenabledAt: null } }) => {
      if (options.lookupFails) throw new Error("suppression table unavailable");
      const row = (options.suppressions ?? []).find((candidate) => candidate.normalizedEmail === where.normalizedEmail && candidate.reenabledAt === null);
      return row ? { reason: row.reason, suppressedAt: row.suppressedAt } : null;
    }),
    findMany: vi.fn(async ({ where }: { where: { normalizedEmail: { in: string[] } } }) =>
      (options.suppressions ?? []).filter((row) => where.normalizedEmail.in.includes(row.normalizedEmail) && row.reenabledAt === null)),
  };
  const prisma = {
    eventMessageSettings: { findUnique: vi.fn(async () => ({ deliveryMode: "EXTERNAL_EMAIL", senderEmail: "registration@imsda.org" })) },
    messageOutbox,
    invoiceDeliveryRecipient: { findFirst: vi.fn(async () => null) },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); return data; }) },
    emailAddressSuppression,
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
  };
  return { prisma, message, audits, attempts, emailAddressSuppression };
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnvCache();
});

const dependencies = { configuration: { apiKey: "re_test_only", apiUrl: "https://api.resend.test" }, now: () => new Date("2026-10-23T12:00:00Z") };
const accepted = () => vi.fn(async () => ({ provider: "SES" as const, providerMessageId: "0100synthetic-ses-message-id-000001" }));

describe("a suppressed address receives nothing (#863)", () => {
  it.each([["BOUNCE", "bounced"], ["COMPLAINT", "complaint"]] as const)("holds back every kind of message to an address with a %s, and says why", async (reason, word) => {
    // A confirmation: not an announcement, so the opt-out check never applies. Suppression still does.
    const store = fakeStore({ suppressions: [{ normalizedEmail: "attendee@example.test", reason, suppressedAt: new Date("2026-10-20T00:00:00Z"), reenabledAt: null }] });
    const sendEmail = accepted();
    const result = await processExternalEmailQueue("event-1", { dependencies: { ...dependencies, prisma: store.prisma as never, sendEmail } });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(result.sentIds).toEqual([]);
    expect(store.message).toMatchObject({ status: "SUPPRESSED", lockToken: null });
    expect(String(store.message.lastError)).toContain(word === "bounced" ? "bounced permanently" : "as spam");
    expect(store.audits).toEqual([expect.objectContaining({ action: "EMAIL_SKIPPED_ADDRESS_SUPPRESSED", entityId: "message-1", metadata: { messageId: "message-1", reason } })]);
    // Ids and the reason only: never the address.
    expect(JSON.stringify(store.audits)).not.toContain("example.test");
  });

  it("compares addresses lower-cased and trimmed", async () => {
    const store = fakeStore({ recipientEmail: "  Attendee@Example.TEST ", suppressions: [{ normalizedEmail: "attendee@example.test", reason: "BOUNCE", suppressedAt: new Date(), reenabledAt: null }] });
    const sendEmail = accepted();
    await processExternalEmailQueue("event-1", { dependencies: { ...dependencies, prisma: store.prisma as never, sendEmail } });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(store.message.status).toBe("SUPPRESSED");
  });

  it("also holds back account email, which has no event (activation and password reset share the worker)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RESEND_API_KEY", "re_test_only");
    vi.stubEnv("APP_BASE_URL", "https://events.imsda.test");
    vi.stubEnv("ACCOUNT_EMAIL_SENDER_ADDRESS", "no-reply@imsda.org");
    resetServerEnvCache();
    const store = fakeStore({ eventId: null, templateKey: "ACCOUNT_PASSWORD_RESET", suppressions: [{ normalizedEmail: "attendee@example.test", reason: "BOUNCE", suppressedAt: new Date(), reenabledAt: null }] });
    const sendEmail = accepted();
    await processAccountEmailQueue({ dependencies: { ...dependencies, prisma: store.prisma as never, sendEmail, prepareBodyText: async () => ({ bodyText: "Choose a new one." }) } });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(store.message.status).toBe("SUPPRESSED");
  });

  it("sends normally to an address that is not suppressed, or whose suppression was re-enabled", async () => {
    for (const suppressions of [[], [{ normalizedEmail: "attendee@example.test", reason: "BOUNCE" as const, suppressedAt: new Date("2026-10-20T00:00:00Z"), reenabledAt: new Date("2026-10-21T00:00:00Z") }]]) {
      const store = fakeStore({ suppressions });
      const sendEmail = accepted();
      const result = await processExternalEmailQueue("event-1", { dependencies: { ...dependencies, prisma: store.prisma as never, sendEmail } });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(result.sentIds).toEqual(["message-1"]);
      expect(store.message.status).toBe("SENT");
    }
  });

  it("fails closed: when the lookup fails the message is retried later and never sent", async () => {
    const store = fakeStore({ lookupFails: true });
    const sendEmail = accepted();
    const result = await processExternalEmailQueue("event-1", { dependencies: { ...dependencies, prisma: store.prisma as never, sendEmail } });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(result.sentIds).toEqual([]);
    expect(store.message.status).toBe("PENDING");
    // Rescheduled for later, as the announcement opt-out check does, and the reason is recorded without any address.
    expect((store.message.availableAt as Date).getTime()).toBeGreaterThan(dependencies.now().getTime());
    expect(String(store.message.lastError)).toContain("Could not confirm the address can receive email");
    expect(String(store.message.lastError)).not.toContain("example.test");
  });

  it("withdraws a club form link that can no longer arrive", async () => {
    const store = fakeStore({ templateKey: "CLUB_FORM_LINK", suppressions: [{ normalizedEmail: "attendee@example.test", reason: "BOUNCE", suppressedAt: new Date(), reenabledAt: null }] });
    const sendEmail = accepted();
    await processExternalEmailQueue("event-1", { dependencies: { ...dependencies, prisma: store.prisma as never, sendEmail } });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(store.message.status).toBe("SUPPRESSED");
  });
});
