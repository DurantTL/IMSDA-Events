import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/communications/effective-delivery", async () => {
  const double = (await import("./support/effective-delivery-double")).effectiveDeliveryDouble;
  return {
    ...double,
    checkRecipientDeliverable: async (...args: unknown[]) => {
      const real = await vi.importActual<typeof import("@/modules/communications/effective-delivery")>("@/modules/communications/effective-delivery");
      return (real.checkRecipientDeliverable as (...inner: unknown[]) => Promise<unknown>)(...args);
    },
  };
});

import { isSesEmailConfiguration, type SesEmailConfiguration } from "@/integrations/email/ses";
import {
  EmailProviderConfigurationError,
  EmailProviderRequestError,
  type EmailDeliveryInput,
} from "@/integrations/email/types";
import type { ResendEmailConfiguration } from "@/integrations/email/resend";
import {
  BACKUP_PROVIDER_LIMIT_ERROR_CODE,
  BACKUP_PROVIDER_LIMIT_MESSAGE,
  ExternalEmailDeliveryError,
  processAccountEmailQueue,
  processExternalEmailQueue,
  summarizeAttemptHistory,
} from "@/modules/communications/email-delivery";

/**
 * #1444: Amazon SES sends everything and Resend takes over only when SES definitely did not accept a message.
 * Mocked providers throughout: neither SES nor Resend is ever called. Synthetic data only.
 */

const now = new Date("2026-11-01T12:00:00Z");
const ses: SesEmailConfiguration = {
  smtpHost: "email-smtp.us-east-2.amazonaws.com",
  smtpPort: 587,
  username: "synthetic-user",
  password: "synthetic-password",
  region: "us-east-2",
  configurationSet: null,
  maxSendRate: 1000,
};
const resend: ResendEmailConfiguration = { apiKey: "re_test_only", apiUrl: "https://api.resend.test" };

type Message = Record<string, unknown> & { id: string; status: string; recipientEmail: string; lockToken: string | null };
type Attempt = { provider: string; status: string; providerMetadata: Record<string, unknown> | null; errorCode?: string };

function fakeStore(options: { suppressed?: boolean; historyFails?: boolean; priorAttempts?: Attempt[] } = {}) {
  const message: Message = {
    id: "message-1",
    eventId: "event-1",
    accountUserId: null,
    accountAttendeeId: null,
    templateKey: "REGISTRATION_CONFIRMATION_PAID",
    registrationId: "registration-1",
    recipientEmail: "attendee@example.test",
    senderNameSnapshot: "IMSDA Events",
    senderEmailSnapshot: "registration@imsda.org",
    replyToEmailSnapshot: null,
    subjectSnapshot: "Registration received",
    bodyTextSnapshot: "Your registration is saved.",
    bodyHtmlSnapshot: null,
    status: "PENDING",
    attemptCount: 0,
    availableAt: new Date("2026-11-01T11:00:00Z"),
    createdAt: new Date("2026-11-01T10:00:00Z"),
    lockedAt: null,
    lockToken: null,
  };
  const audits: Array<Record<string, unknown>> = [];
  const attempts: Attempt[] = [...(options.priorAttempts ?? [])];
  const messageOutbox = {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => (message.status === "PENDING" && (message.availableAt as Date) <= now ? { ...message, attachment: null, files: [] } : null)),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (where.id !== message.id || (where.status && where.status !== message.status)) return { count: 0 };
      if ("lockToken" in where && where.lockToken !== message.lockToken) return { count: 0 };
      Object.assign(message, data);
      return { count: 1 };
    }),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(message, data)),
  };
  const messageDeliveryAttempt = {
    create: vi.fn(async ({ data }: { data: Attempt & Record<string, unknown> }) => { attempts.push(data); return data; }),
    findFirst: vi.fn(async () => null),
    findMany: vi.fn(async () => {
      if (options.historyFails) throw new Error("attempt table unavailable");
      return attempts.map((attempt) => ({ provider: attempt.provider, status: attempt.status, providerMetadata: attempt.providerMetadata }));
    }),
    aggregate: vi.fn(async () => ({ _max: { attemptNumber: attempts.length || null } })),
  };
  const tx = {
    messageOutbox,
    messageDeliveryAttempt,
    messageProviderEvent: { updateMany: vi.fn(async () => ({ count: 0 })), findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    clubFormLink: { updateMany: vi.fn(async () => ({ count: 1 })) },
    healthRecordLink: { updateMany: vi.fn(async () => ({ count: 0 })) },
  };
  const emailAddressSuppression = {
    findFirst: vi.fn(async () => (options.suppressed ? { reason: "BOUNCE", suppressedAt: new Date("2026-10-20T00:00:00Z") } : null)),
    findMany: vi.fn(async () => (options.suppressed ? [{ normalizedEmail: "attendee@example.test", reason: "BOUNCE", suppressedAt: new Date("2026-10-20T00:00:00Z"), reenabledAt: null }] : [])),
  };
  const prisma = {
    eventMessageSettings: { findUnique: vi.fn(async () => ({ deliveryMode: "EXTERNAL_EMAIL", senderEmail: "registration@imsda.org" })) },
    messageOutbox,
    messageDeliveryAttempt,
    invoiceDeliveryRecipient: { findFirst: vi.fn(async () => null) },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); return data; }) },
    emailAddressSuppression,
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
  };
  return { prisma, message, attempts, audits };
}

/** One mock that behaves per configuration type, and records which provider each call reached. */
function providers(behaviour: { ses?: () => unknown; resend?: () => unknown } = {}) {
  const calls: Array<"SES" | "RESEND"> = [];
  const sendEmail = vi.fn(async (_input: EmailDeliveryInput, configuration?: unknown) => {
    if (isSesEmailConfiguration(configuration)) {
      calls.push("SES");
      if (behaviour.ses) {
        const outcome = behaviour.ses();
        if (outcome instanceof Error) throw outcome;
      }
      return { provider: "SES" as const, providerMessageId: "0100synthetic-ses-id-000001" };
    }
    calls.push("RESEND");
    if (behaviour.resend) {
      const outcome = behaviour.resend();
      if (outcome instanceof Error) throw outcome;
    }
    return { provider: "RESEND" as const, providerMessageId: "synthetic-resend-id-1" };
  });
  return { sendEmail, calls };
}

const refused = (code = "PROVIDER_RATE_LIMITED", status = 454) =>
  new EmailProviderRequestError("Amazon SES is limiting the sending rate. The message will be retried.", code, true, status, true);
const ambiguous = () => new EmailProviderRequestError("The email provider could not be reached.", "NETWORK_ERROR", true, 0, false);

function run(store: ReturnType<typeof fakeStore>, mocks: ReturnType<typeof providers>, extra: Record<string, unknown> = {}) {
  return processExternalEmailQueue("event-1", {
    dependencies: {
      configuration: ses,
      backupConfiguration: resend,
      prisma: store.prisma as never,
      sendEmail: mocks.sendEmail as never,
      now: () => now,
      ...extra,
    },
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("fail over only when SES definitely did not accept the message", () => {
  it("sends through Resend after a refusal, and records the provider that handled it", async () => {
    const store = fakeStore();
    const mocks = providers({ ses: () => refused() });
    const result = await run(store, mocks);
    expect(mocks.calls).toEqual(["SES", "RESEND"]);
    expect(result.sentIds).toEqual(["message-1"]);
    expect(store.message).toMatchObject({ status: "SENT", provider: "RESEND", providerMessageId: "synthetic-resend-id-1" });
    expect(store.attempts).toEqual([expect.objectContaining({
      provider: "RESEND",
      status: "SENT",
      providerMetadata: expect.objectContaining({ failover: true, primaryErrorCode: "PROVIDER_RATE_LIMITED", idempotencyKey: "outbox:message-1" }),
    })]);
    // Codes only: never provider text, an address or a key.
    expect(JSON.stringify(store.attempts)).not.toContain("example.test");
    expect(JSON.stringify(store.attempts)).not.toContain("re_test_only");
  });

  it("sends the same idempotency key to both providers, so Resend can dedupe a repeat", async () => {
    const store = fakeStore();
    const mocks = providers({ ses: () => refused("SMTP_421", 421) });
    await run(store, mocks);
    const keys = mocks.sendEmail.mock.calls.map(([payload]) => payload.idempotencyKey);
    expect(keys).toEqual(["outbox:message-1", "outbox:message-1"]);
  });

  it("fails over on a batch-wide SES configuration error (bad credentials) without stopping the run", async () => {
    const store = fakeStore();
    const mocks = providers({ ses: () => new EmailProviderConfigurationError("Amazon SES rejected the SMTP username or password.") });
    const result = await run(store, mocks);
    expect(mocks.calls).toEqual(["SES", "RESEND"]);
    expect(result.sentIds).toEqual(["message-1"]);
    expect(store.attempts[0]).toMatchObject({ provider: "RESEND", providerMetadata: { failover: true, primaryErrorCode: "PROVIDER_CONFIGURATION_ERROR" } });
  });

  it("does not fail over after an ambiguous error (a drop after the data was sent): it keeps today's retry on SES", async () => {
    const store = fakeStore();
    const mocks = providers({ ses: () => ambiguous() });
    const result = await run(store, mocks);
    expect(mocks.calls).toEqual(["SES"]);
    expect(result.rescheduledIds).toEqual(["message-1"]);
    expect(store.message.status).toBe("PENDING");
    expect(store.attempts[0]).toMatchObject({ provider: "SES", status: "FAILED", providerMetadata: { notAccepted: false, rescheduled: true } });
  });

  it.each([
    ["an invalid address", () => new EmailProviderRequestError("The recipient is not valid.", "INVALID_ADDRESS", false, 0)],
    ["an invalid message", () => new EmailProviderRequestError("The message could not be built for delivery.", "INVALID_MESSAGE", false, 0)],
    ["a bad unsubscribe header", () => new EmailProviderConfigurationError("The unsubscribe link for this message is not a valid web address.", false)],
  ])("does not fail over for %s: that is not a provider outage", async (_name, make) => {
    const store = fakeStore();
    const mocks = providers({ ses: make });
    await run(store, mocks);
    expect(mocks.calls).toEqual(["SES"]);
    expect(store.message.status).toBe("FAILED");
  });
});

describe("a message is never sent twice, across attempts", () => {
  it("after an ambiguous SES attempt, a later attempt never fails over", async () => {
    const store = fakeStore();
    const first = providers({ ses: () => ambiguous() });
    await run(store, first);
    expect(first.calls).toEqual(["SES"]);

    store.message.availableAt = new Date("2026-11-01T11:00:00Z");
    const second = providers({ ses: () => refused() });
    const result = await run(store, second);
    // SES refused this time, but the first attempt may have been accepted: the backup must not send it.
    expect(second.calls).toEqual(["SES"]);
    expect(result.rescheduledIds).toEqual(["message-1"]);
    expect(store.attempts.map((attempt) => attempt.provider)).toEqual(["SES", "SES"]);
  });

  it("after a stale lock (a worker died mid-send), a later attempt never fails over", async () => {
    const store = fakeStore({ priorAttempts: [{ provider: "SES", status: "FAILED", providerMetadata: { recoveredStaleLock: true } }] });
    const mocks = providers({ ses: () => refused() });
    await run(store, mocks);
    expect(mocks.calls).toEqual(["SES"]);
  });

  it("after a refused SES attempt that failed over, later attempts use only the backup", async () => {
    const store = fakeStore();
    const first = providers({ ses: () => refused(), resend: () => new EmailProviderRequestError("The email provider could not be reached.", "NETWORK_ERROR", true, 0) });
    const firstResult = await run(store, first);
    expect(first.calls).toEqual(["SES", "RESEND"]);
    expect(firstResult.rescheduledIds).toEqual(["message-1"]);
    expect(store.attempts[0]).toMatchObject({ provider: "RESEND", status: "FAILED", providerMetadata: { failover: true, primaryErrorCode: "PROVIDER_RATE_LIMITED" } });

    store.message.availableAt = new Date("2026-11-01T11:00:00Z");
    const second = providers();
    const result = await run(store, second);
    // SES is not asked again, even though it might well accept it now.
    expect(second.calls).toEqual(["RESEND"]);
    expect(result.sentIds).toEqual(["message-1"]);
    expect(store.message).toMatchObject({ status: "SENT", provider: "RESEND" });
    expect(store.attempts[1]).toMatchObject({ provider: "RESEND", status: "SENT", providerMetadata: { failover: true, primaryErrorCode: "PROVIDER_RATE_LIMITED" } });
  });

  it("after a refused SES attempt that was not failed over (earlier), the next attempt may still fail over", async () => {
    const store = fakeStore({ priorAttempts: [{ provider: "SES", status: "FAILED", providerMetadata: { notAccepted: true, realDelivery: true } }] });
    const mocks = providers({ ses: () => refused() });
    await run(store, mocks);
    expect(mocks.calls).toEqual(["SES", "RESEND"]);
  });

  it("holds the message, sending nothing, when its earlier attempts cannot be read", async () => {
    const store = fakeStore({ historyFails: true });
    const mocks = providers();
    const result = await run(store, mocks);
    expect(mocks.calls).toEqual([]);
    expect(result.rescheduledIds).toEqual(["message-1"]);
    expect(store.message.status).toBe("PENDING");
    // Not a provider attempt, so no provider is recorded against it.
    expect(store.attempts[0]).toMatchObject({ provider: "INTERNAL", errorCode: "DELIVERY_HISTORY_UNAVAILABLE" });
  });

  it("reads the history as a pure function of provider and metadata", () => {
    expect(summarizeAttemptHistory([])).toEqual({ usedBackup: false, ambiguousPrimary: false, primaryErrorCode: null });
    expect(summarizeAttemptHistory([{ provider: "SES", status: "FAILED", providerMetadata: { notAccepted: true } }])).toMatchObject({ usedBackup: false, ambiguousPrimary: false });
    // Recorded before the backup existed: unknown, so ambiguous.
    expect(summarizeAttemptHistory([{ provider: "SES", status: "FAILED", providerMetadata: { retryable: true } }])).toMatchObject({ ambiguousPrimary: true });
    // A pre-send check that never reached a provider is not an attempt.
    expect(summarizeAttemptHistory([{ provider: "INTERNAL", status: "FAILED", providerMetadata: { realDelivery: false } }])).toMatchObject({ usedBackup: false, ambiguousPrimary: false });
    expect(summarizeAttemptHistory([{ provider: "RESEND", status: "FAILED", providerMetadata: { failover: true, primaryErrorCode: "SMTP_421" } }])).toEqual({ usedBackup: true, ambiguousPrimary: false, primaryErrorCode: "SMTP_421" });
  });
});

describe("one suppression list guards both providers", () => {
  it("a suppressed address is sent by neither SES nor Resend", async () => {
    const store = fakeStore({ suppressed: true });
    const mocks = providers({ ses: () => refused() });
    const result = await run(store, mocks);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(result.sentIds).toEqual([]);
    expect(store.message.status).toBe("SUPPRESSED");
  });

  it("also holds back a direct backup send (the tester path)", async () => {
    const store = fakeStore({ suppressed: true });
    const mocks = providers();
    await run(store, mocks);
    expect(mocks.calls).toEqual([]);
  });
});

describe("the backup's own limit ends the message, with no loop", () => {
  it.each(["daily_quota_exceeded", "rate_limit_exceeded"])("Resend %s while acting as the backup: FAILED, never rescheduled", async (name) => {
    const store = fakeStore();
    const mocks = providers({
      ses: () => refused(),
      resend: () => new EmailProviderRequestError("Too many requests.", name, true, 429),
    });
    const result = await run(store, mocks);
    expect(mocks.calls).toEqual(["SES", "RESEND"]);
    expect(result.failedIds).toEqual(["message-1"]);
    expect(result.rescheduledIds).toEqual([]);
    expect(store.message).toMatchObject({ status: "FAILED", lastError: BACKUP_PROVIDER_LIMIT_MESSAGE });
    expect(BACKUP_PROVIDER_LIMIT_MESSAGE).toBe("Amazon SES could not send this and the backup service (Resend) has reached its sending limit.");
    expect(store.attempts[0]).toMatchObject({ provider: "RESEND", errorCode: BACKUP_PROVIDER_LIMIT_ERROR_CODE, providerMetadata: { retryable: false, rescheduled: false, failover: true } });
    // Nothing is left to pick up again.
    store.message.availableAt = new Date("2026-11-01T11:00:00Z");
    const again = providers();
    await run(store, again);
    expect(again.calls).toEqual([]);
  });

  it("other backup failures follow the normal retry rules", async () => {
    const store = fakeStore();
    const mocks = providers({ ses: () => refused(), resend: () => new EmailProviderRequestError("Server error.", "HTTP_500", true, 500) });
    const result = await run(store, mocks);
    expect(result.rescheduledIds).toEqual(["message-1"]);
    expect(store.message.status).toBe("PENDING");
  });
});

describe("with the backup unset, nothing changes", () => {
  it("a refused SES message is retried on SES alone and Resend is never called", async () => {
    const store = fakeStore();
    const mocks = providers({ ses: () => refused() });
    const result = await run(store, mocks, { backupConfiguration: null });
    expect(mocks.calls).toEqual(["SES"]);
    expect(result.rescheduledIds).toEqual(["message-1"]);
    // No failover facts and no history read.
    expect(store.prisma.messageDeliveryAttempt.findMany).not.toHaveBeenCalled();
    expect(store.attempts[0].providerMetadata).not.toHaveProperty("notAccepted");
    expect(store.attempts[0].providerMetadata).not.toHaveProperty("failover");
  });

  it("a batch-wide SES configuration error still stops the run", async () => {
    const store = fakeStore();
    const mocks = providers({ ses: () => new EmailProviderConfigurationError("Amazon SES rejected the SMTP username or password.") });
    await expect(run(store, mocks, { backupConfiguration: null })).rejects.toBeInstanceOf(ExternalEmailDeliveryError);
    expect(mocks.calls).toEqual(["SES"]);
  });

  it("reads the environment: unset, blank, a typo, the primary itself, or a missing key all leave the backup off", async () => {
    for (const [provider, backup, key] of [["ses", undefined, "re_x"], ["ses", "", "re_x"], ["ses", "sendgrid", "re_x"], ["resend", "resend", "re_x"], ["ses", "resend", ""]] as const) {
      vi.stubEnv("EMAIL_PROVIDER", provider);
      vi.stubEnv("EMAIL_BACKUP_PROVIDER", backup ?? "");
      vi.stubEnv("RESEND_API_KEY", key);
      const store = fakeStore();
      const mocks = providers({ ses: () => refused() });
      await processExternalEmailQueue("event-1", {
        dependencies: { configuration: ses, prisma: store.prisma as never, sendEmail: mocks.sendEmail as never, now: () => now },
      });
      expect(mocks.calls).toEqual(["SES"]);
    }
  });

  it("is on with the three settings together", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "ses");
    vi.stubEnv("EMAIL_BACKUP_PROVIDER", " Resend ");
    vi.stubEnv("RESEND_API_KEY", "re_test_only");
    const store = fakeStore();
    const mocks = providers({ ses: () => refused() });
    await processExternalEmailQueue("event-1", {
      dependencies: { configuration: ses, prisma: store.prisma as never, sendEmail: mocks.sendEmail as never, now: () => now },
    });
    expect(mocks.calls).toEqual(["SES", "RESEND"]);
  });
});

describe("a failed SES pre-flight hands the run to the backup", () => {
  it.each([
    ["unreachable", () => new EmailProviderRequestError("The email provider could not be reached.", "NETWORK_ERROR", true, 0, true), "NETWORK_ERROR"],
    ["bad credentials", () => new EmailProviderConfigurationError("Amazon SES rejected the SMTP username or password."), "PROVIDER_CONFIGURATION_ERROR"],
  ])("%s: this run sends through Resend and records why", async (_name, make, code) => {
    const store = fakeStore();
    const mocks = providers();
    const preflight = vi.fn(async () => { throw make(); });
    const result = await run(store, mocks, { preflight });
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(mocks.calls).toEqual(["RESEND"]);
    expect(result.sentIds).toEqual(["message-1"]);
    expect(store.attempts[0]).toMatchObject({ provider: "RESEND", status: "SENT", providerMetadata: { failover: true, preflight: true, primaryErrorCode: code } });
  });

  it("does not send through the backup for a message whose earlier SES attempt was ambiguous", async () => {
    const store = fakeStore({ priorAttempts: [{ provider: "SES", status: "FAILED", providerMetadata: { notAccepted: false, realDelivery: true } }] });
    const mocks = providers({ ses: () => ambiguous() });
    await run(store, mocks, { preflight: vi.fn(async () => { throw new EmailProviderRequestError("x", "NETWORK_ERROR", true, 0, true); }) });
    expect(mocks.calls).toEqual(["SES"]);
  });

  it("without a backup, an unreachable SES still ends the run with nothing claimed, and bad credentials still stop it", async () => {
    const mocks = providers();
    const unreachable = fakeStore();
    const result = await run(unreachable, mocks, {
      backupConfiguration: null,
      preflight: vi.fn(async () => { throw new EmailProviderRequestError("x", "NETWORK_ERROR", true, 0, true); }),
    });
    expect(result.sentIds).toEqual([]);
    expect(unreachable.message.status).toBe("PENDING");
    expect(mocks.sendEmail).not.toHaveBeenCalled();

    const badLogin = fakeStore();
    await expect(run(badLogin, mocks, {
      backupConfiguration: null,
      preflight: vi.fn(async () => { throw new EmailProviderConfigurationError("bad login"); }),
    })).rejects.toBeInstanceOf(ExternalEmailDeliveryError);
  });
});

describe("the tester's direct backup send", () => {
  const accountDependencies = (store: ReturnType<typeof fakeStore>, mocks: ReturnType<typeof providers>, extra: Record<string, unknown> = {}) => ({
    configuration: ses,
    backupConfiguration: resend,
    prisma: store.prisma as never,
    sendEmail: mocks.sendEmail as never,
    now: () => now,
    prepareBodyText: async () => ({ bodyText: "Test body." }),
    ...extra,
  });

  it("goes straight to Resend and never touches SES, recorded as a direct send, not a failover", async () => {
    vi.stubEnv("ACCOUNT_EMAIL_SENDER_ADDRESS", "no-reply@imsda.org");
    const store = fakeStore();
    store.message.eventId = null;
    store.message.templateKey = "SYSTEM_TEST_EMAIL";
    const mocks = providers({ ses: () => refused() });
    const result = await processAccountEmailQueue({ useBackup: true, messageIds: ["message-1"], dependencies: accountDependencies(store, mocks) });
    expect(mocks.calls).toEqual(["RESEND"]);
    expect(result.sentIds).toEqual(["message-1"]);
    expect(store.message).toMatchObject({ status: "SENT", provider: "RESEND" });
    expect(store.attempts[0].providerMetadata).toMatchObject({ directBackup: true });
    expect(store.attempts[0].providerMetadata).not.toHaveProperty("failover");
  });

  it("is refused when the backup is not configured", async () => {
    vi.stubEnv("ACCOUNT_EMAIL_SENDER_ADDRESS", "no-reply@imsda.org");
    const store = fakeStore();
    const mocks = providers();
    await expect(processAccountEmailQueue({ useBackup: true, dependencies: accountDependencies(store, mocks, { backupConfiguration: null }) }))
      .rejects.toBeInstanceOf(ExternalEmailDeliveryError);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
