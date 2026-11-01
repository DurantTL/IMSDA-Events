import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  getEmailBackupStatus: vi.fn(),
  getAccountEmailSender: vi.fn(),
  processAccountEmailQueue: vi.fn(),
  writeAuditLog: vi.fn(),
  logError: vi.fn(),
  outbox: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  providerEvents: { findMany: vi.fn() },
  attempts: { findFirst: vi.fn(), count: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", async () => ({ ...(await vi.importActual<object>("@/lib/logger")), logError: mocks.logError }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/integrations/email/provider", () => ({
  getEmailBackupStatus: mocks.getEmailBackupStatus,
  getActiveEmailProviderName: () => "SES",
  getEmailAvailability: () => ({ deliveryConfigured: true, webhookConfigured: true }),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/communications/account-email", () => ({
  AccountEmailNotConfiguredError: class extends Error {},
  getAccountEmailSender: mocks.getAccountEmailSender,
}));
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: mocks.processAccountEmailQueue }));
vi.mock("@/modules/rate-limit/service", () => ({
  checkSystemEmailTestRateLimit: async () => ({ allowed: true, decisions: [] }),
  checkSystemSquareTestRateLimit: vi.fn(),
}));

import { buildEmailBackupProviders } from "@/modules/system-admin/system-report/email-backup-providers";
import {
  BACKUP_SETUP_STEPS,
  backupSentFields,
  backupServiceFields,
  backupSetupFields,
} from "@/modules/system-admin/system-report/email-backup-signals";
import { runEmailTest, emailTestInputSchema, mapEmailTestStatus } from "@/modules/system-admin/system-report/email-tester";
import { defineProvider } from "@/modules/system-admin/system-report/providers";

/** #1444: the backup rows on the System report and the tester's backup option. Synthetic data only. */

const now = new Date("2026-11-01T12:00:00.000Z");
const active = { active: true, reason: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  mocks.getPrisma.mockReturnValue({ messageDeliveryAttempt: mocks.attempts, messageOutbox: mocks.outbox, messageProviderEvent: mocks.providerEvents });
  mocks.getEmailBackupStatus.mockReturnValue(active);
  mocks.getAccountEmailSender.mockReturnValue({ name: "IMSDA Events", address: "events@example.org", replyTo: null });
  mocks.outbox.create.mockResolvedValue({ id: "msg_test_1" });
  mocks.outbox.updateMany.mockResolvedValue({ count: 0 });
  mocks.outbox.findFirst.mockResolvedValue({
    id: "msg_test_1", status: "SENT", createdAt: new Date(now.getTime() - 1000), sentAt: new Date(now.getTime() - 500), provider: "RESEND",
    providerDeliveryStatus: "DELIVERED", providerStatusAt: now, deliveredAt: now, failedAt: null,
    metadata: { trigger: "SYSTEM_REPORT_TEST", testRef: "T-7Q2K", testedByUserId: "user_admin_1" },
  });
  mocks.providerEvents.findMany.mockResolvedValue([]);
  mocks.processAccountEmailQueue.mockResolvedValue({ recoveredIds: [], sentIds: ["msg_test_1"], failedIds: [], rescheduledIds: [] });
  mocks.writeAuditLog.mockResolvedValue({});
  mocks.attempts.findFirst.mockResolvedValue(null);
  mocks.attempts.count.mockResolvedValue(0);
});
afterEach(() => vi.useRealTimers());

describe("Backup email service row", () => {
  it("is information, not a problem, when the backup was never asked for", () => {
    const row = backupServiceFields("k", { status: { active: false, reason: "not_set" }, lastUsedAt: null, now });
    expect(row).toMatchObject({ state: "info", resultText: expect.stringContaining("Not set up") });
  });

  it.each(["invalid_value", "same_as_primary", "primary_not_ses", "missing_api_key"] as const)("reports a backup that was asked for but cannot work (%s) as check soon", (reason) => {
    const row = backupServiceFields("k", { status: { active: false, reason }, lastUsedAt: null, now });
    expect(row.state).toBe("watch");
    expect(row.resultText).toContain("Not set up");
  });

  it("says configured with its last use, or that it has not been needed", () => {
    const used = backupServiceFields("k", { status: active, lastUsedAt: new Date("2026-10-30T08:15:00Z"), now });
    expect(used).toMatchObject({ state: "ok", whenLabel: "Last used", checkedAt: "2026-10-30T08:15:00.000Z" });
    expect(used.resultText).toContain("2026-10-30 08:15 UTC");
    const unused = backupServiceFields("k", { status: active, lastUsedAt: null, now });
    expect(unused).toMatchObject({ state: "ok", checkedAt: null, noTimeLabel: "Never" });
  });
});

describe("Emails sent by backup (7 days) row", () => {
  it("is OK at zero and warns above zero, with counts only", () => {
    expect(backupSentFields("k", { count: 0, now })).toMatchObject({ state: "ok" });
    const one = backupSentFields("k", { count: 1, now });
    expect(one.state).toBe("watch");
    expect(one.resultText).toContain("1 email was sent by the backup");
    expect(backupSentFields("k", { count: 12, now }).resultText).toContain("12 emails were sent by the backup");
  });
});

describe("Backup setup panel", () => {
  it("lists the settings and the DNS for both services, as fixed words and never a value", () => {
    const row = backupSetupFields("k", now);
    const text = (row.items ?? []).join("\n");
    for (const name of ["EMAIL_PROVIDER=ses", "EMAIL_BACKUP_PROVIDER=resend", "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "SES_SMTP_USERNAME"]) {
      expect(text).toContain(name);
    }
    expect(text).toMatch(/Amazon SES: .*SPF.*DKIM/);
    expect(text).toMatch(/Resend: .*SPF.*DKIM/);
    expect(row.countsTowardOverall).toBe(false);
    expect(row.items).toEqual([...BACKUP_SETUP_STEPS]);
  });
});

describe("the backup provider on the System report", () => {
  const load = () => buildEmailBackupProviders(defineProvider)[0].load(now);

  it("counts only SES-to-Resend failover sends in the last 7 days, and reads the last one", async () => {
    mocks.attempts.findFirst.mockResolvedValue({ completedAt: new Date("2026-10-31T10:00:00Z") });
    mocks.attempts.count.mockResolvedValue(3);
    const rows = await load();
    expect(rows.map((row) => row.key)).toEqual(["email-backup", "email-backup-sent", "email-backup-setup"]);
    expect(rows.every((row) => row.section === "email")).toBe(true);
    expect(rows[0]).toMatchObject({ state: "ok", checkedAt: "2026-10-31T10:00:00.000Z" });
    expect(rows[1]).toMatchObject({ state: "watch" });
    const where = mocks.attempts.count.mock.calls[0][0].where;
    expect(where).toMatchObject({ provider: "RESEND", status: "SENT", providerMetadata: { path: ["failover"], equals: true } });
    expect(where.completedAt.gte).toEqual(new Date("2026-10-25T12:00:00.000Z"));
    // Never anything but counts and times.
    expect(JSON.stringify(rows)).not.toMatch(/@|re_/);
  });

  it("shows an unavailable row, not zero, when the read fails", async () => {
    mocks.attempts.count.mockRejectedValue(new Error("database down"));
    const rows = await load();
    expect(rows[0].state).toBe("unavailable");
    expect(rows[1].state).toBe("unavailable");
    expect(rows[2].state).toBe("info");
  });
});

describe("email tester: send through the backup", () => {
  const user = { id: "user_admin_1" };

  it("accepts the option only as a boolean", () => {
    expect(emailTestInputSchema.safeParse({ to: "me@example.org", backup: true }).success).toBe(true);
    expect(emailTestInputSchema.safeParse({ to: "me@example.org", backup: "yes" }).success).toBe(false);
  });

  it("sends the test through the backup when it is configured", async () => {
    const run = await runEmailTest({ user, body: { to: "me@example.org", backup: true }, now });
    expect(run.kind).toBe("started");
    expect(mocks.processAccountEmailQueue).toHaveBeenCalledWith({ messageIds: ["msg_test_1"], limit: 1, useBackup: true });
    // The result names the provider that sent it.
    if (run.kind === "started") expect(run.status.provider).toBe("Resend");
  });

  it("refuses on the server, before anything is queued, when the backup is not configured", async () => {
    mocks.getEmailBackupStatus.mockReturnValue({ active: false, reason: "not_set" });
    const run = await runEmailTest({ user, body: { to: "me@example.org", backup: true }, now });
    expect(run).toEqual({ kind: "backup-not-configured" });
    expect(mocks.outbox.create).not.toHaveBeenCalled();
    expect(mocks.processAccountEmailQueue).not.toHaveBeenCalled();
  });

  it("a normal test does not ask for the backup", async () => {
    await runEmailTest({ user, body: { to: "me@example.org" }, now });
    expect(mocks.processAccountEmailQueue).toHaveBeenCalledWith({ messageIds: ["msg_test_1"], limit: 1 });
  });

  it("labels the provider a result came from", () => {
    const status = mapEmailTestStatus({
      id: "m", status: "SENT", createdAt: now, sentAt: now, provider: "RESEND", providerDeliveryStatus: "ACCEPTED",
      providerStatusAt: now, deliveredAt: null, failedAt: null, metadata: { testRef: "T-7Q2K" },
    }, [], now);
    expect(status.provider).toBe("Resend");
  });
});
