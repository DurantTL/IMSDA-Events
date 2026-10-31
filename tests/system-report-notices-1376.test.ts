import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  getActiveEmailProviderName: vi.fn(),
  getEmailAvailability: vi.fn(),
  getSquareConfiguration: vi.fn(),
  isAlertDeliveryConfigured: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/logger", async () => {
  const actual = await vi.importActual<typeof import("@/lib/logger")>("@/lib/logger");
  return { ...actual, logError: mocks.logError };
});
vi.mock("@/integrations/email/provider", () => ({
  getActiveEmailProviderName: mocks.getActiveEmailProviderName,
  getEmailAvailability: mocks.getEmailAvailability,
}));
vi.mock("@/modules/operations/alerting", () => ({ isAlertDeliveryConfigured: mocks.isAlertDeliveryConfigured }));
vi.mock("@/modules/payments/square-config", () => ({ getSquareConfiguration: mocks.getSquareConfiguration }));

import { SECTION_DEFINITIONS } from "@/modules/system-admin/system-report/model";
import { buildNoticeProviders } from "@/modules/system-admin/system-report/notice-providers";
import { emailNoticeFields, rejectedNoticeFields, squareNoticeFields, suppressionFields } from "@/modules/system-admin/system-report/notice-signals";
import { defineProvider, systemReportProviders } from "@/modules/system-admin/system-report/providers";

/** #1376: payment and email notices. Synthetic data only. */

const now = new Date("2026-10-31T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

describe("Square notices", () => {
  const base = { configured: true, ignoredCount: 3, now };
  it("is information when Square is not set up", () => {
    expect(squareNoticeFields("k", { ...base, configured: false, lastNoticeAt: null, newestPaymentAt: null })).toMatchObject({ state: "info", resultText: expect.stringContaining("not set up") });
  });
  it("is information, never OK, with no payments to compare", () => {
    const row = squareNoticeFields("k", { ...base, lastNoticeAt: hoursAgo(2), newestPaymentAt: null });
    expect(row.state).toBe("info");
    expect(row.resultText).toContain("3 notices were ignored");
  });
  it("watches when a notice came between the oldest and the newest payment but none since the newest", () => {
    // oldest payment 20h ago, notice 10h ago, newest payment 3h ago: notices stopped mid-window.
    expect(squareNoticeFields("k", { ...base, lastNoticeAt: hoursAgo(10), newestPaymentAt: hoursAgo(3) }).state).toBe("watch");
  });
  it("is OK when a notice arrived at or after the newest due payment", () => {
    expect(squareNoticeFields("k", { ...base, lastNoticeAt: hoursAgo(3), newestPaymentAt: hoursAgo(3) }).state).toBe("ok");
  });
  it("watches when payments were made and no notice came after them", () => {
    expect(squareNoticeFields("k", { ...base, lastNoticeAt: hoursAgo(30), newestPaymentAt: hoursAgo(3) }).state).toBe("watch");
    expect(squareNoticeFields("k", { ...base, lastNoticeAt: null, newestPaymentAt: hoursAgo(3) })).toMatchObject({ state: "watch", checkedAt: null, noTimeLabel: "Never" });
  });
});

describe("email notices", () => {
  const input = { active: "RESEND" as const, webhookConfigured: true, now };
  it("says Not in use for the other provider", () => {
    expect(emailNoticeFields("k", "SES", { ...input, lastNoticeAt: null, newestSentAt: null })).toMatchObject({ state: "info", resultText: expect.stringContaining("Not in use") });
  });
  it("watches when the active provider's notices are not set up", () => {
    const row = emailNoticeFields("k", "RESEND", { ...input, webhookConfigured: false, lastNoticeAt: null, newestSentAt: null });
    expect(row.state).toBe("watch");
    expect(row.resultText).toContain("bounces and complaints aren't received");
  });
  it("is information when nothing is older than the grace period", () => {
    // The provider reads only sends older than 15 minutes, so a send inside the grace period arrives as null here.
    expect(emailNoticeFields("k", "RESEND", { ...input, lastNoticeAt: hoursAgo(5), newestSentAt: null }).state).toBe("info");
  });
  it("compares sends with notices", () => {
    expect(emailNoticeFields("k", "RESEND", { ...input, lastNoticeAt: null, newestSentAt: null }).state).toBe("info");
    expect(emailNoticeFields("k", "RESEND", { ...input, lastNoticeAt: hoursAgo(1), newestSentAt: hoursAgo(5) }).state).toBe("ok");
    expect(emailNoticeFields("k", "RESEND", { ...input, lastNoticeAt: hoursAgo(50), newestSentAt: hoursAgo(5) }).state).toBe("watch");
  });
});

describe("rejected notices", () => {
  const base = { active: "RESEND" as const, alertDeliveryConfigured: false, now };
  it("needs attention for a Square rejection, even when Resend also rejected", () => {
    const row = rejectedNoticeFields("k", { ...base, squareRejectedAt: hoursAgo(5), resendRejectedAt: hoursAgo(1) });
    expect(row.state).toBe("attention");
    expect(row.checkedAt).toBe(hoursAgo(1).toISOString());
    expect(row.resultText).toContain("not kept");
  });
  it("watches for a Resend rejection alone", () => {
    expect(rejectedNoticeFields("k", { ...base, squareRejectedAt: null, resendRejectedAt: hoursAgo(1) }).state).toBe("watch");
  });
  it("is OK with none, unless SES is active, where it explains SES is only logged", () => {
    expect(rejectedNoticeFields("k", { ...base, squareRejectedAt: null, resendRejectedAt: null }).state).toBe("ok");
    const ses = rejectedNoticeFields("k", { ...base, active: "SES", squareRejectedAt: null, resendRejectedAt: null });
    expect(ses.state).toBe("info");
    expect(ses.resultText).toContain("server log");
  });
  it("is information, never OK, when an alert webhook is set up (a failed alert is not kept)", () => {
    const row = rejectedNoticeFields("k", { ...base, alertDeliveryConfigured: true, squareRejectedAt: null, resendRejectedAt: null });
    expect(row.state).toBe("info");
    expect(row.resultText).toContain("could not be delivered is not kept");
    expect(rejectedNoticeFields("k", { ...base, alertDeliveryConfigured: true, squareRejectedAt: hoursAgo(1), resendRejectedAt: null }).state).toBe("attention");
  });
});

describe("bounces and complaints", () => {
  it("is counts only", () => {
    const row = suppressionFields("k", { bounces: 2, complaints: 1, now });
    expect(row.state).toBe("info");
    expect(row.resultText).toContain("2 addresses");
  });
});

describe("the notices provider", () => {
  const rows = (provider = buildNoticeProviders(defineProvider)[0]) => provider.load(now);
  const prismaWith = (overrides: Record<string, unknown> = {}) => ({
    squareWebhookEvent: { findFirst: vi.fn().mockResolvedValue({ receivedAt: hoursAgo(1) }), count: vi.fn().mockResolvedValue(2) },
    payment: { findFirst: vi.fn().mockResolvedValue({ receivedAt: hoursAgo(4) }) },
    messageProviderEvent: { findFirst: vi.fn().mockResolvedValue({ receivedAt: hoursAgo(1) }) },
    messageOutbox: { findFirst: vi.fn().mockResolvedValue({ sentAt: hoursAgo(6) }) },
    alertNotification: { findMany: vi.fn().mockResolvedValue([]) },
    emailAddressSuppression: { groupBy: vi.fn().mockResolvedValue([{ reason: "BOUNCE", _count: { _all: 4 } }]) },
    ...overrides,
  });
  beforeEach(() => {
    mocks.isAlertDeliveryConfigured.mockReturnValue(false);
    mocks.getSquareConfiguration.mockReturnValue({ webhookConfigured: true });
    mocks.getActiveEmailProviderName.mockReturnValue("RESEND");
    mocks.getEmailAvailability.mockReturnValue({ deliveryConfigured: true, webhookConfigured: true });
  });

  it("is registered with a declared section", () => {
    expect(systemReportProviders.some((provider) => provider.section === "notices")).toBe(true);
    expect(SECTION_DEFINITIONS.some((section) => section.key === "notices")).toBe(true);
  });

  it("reads each check with the right filters", async () => {
    const prisma = prismaWith();
    mocks.getPrisma.mockReturnValue(prisma);
    const result = await rows();
    expect(Object.fromEntries(result.map((row) => [row.key, row.state]))).toEqual({
      "square-notices": "ok",
      "resend-notices": "ok",
      "ses-notices": "info",
      "rejected-notices": "ok",
      "bounces-complaints": "info",
    });
    const window = (field: "receivedAt" | "sentAt") => ({ [field]: { gte: hoursAgo(24), lte: new Date(now.getTime() - 15 * 60_000) } });
    expect(prisma.payment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { method: "CARD_REFERENCE", status: "SUCCEEDED", paymentAttempt: { isNot: null }, ...window("receivedAt") },
      orderBy: { receivedAt: "desc" },
    }));
    expect(prisma.messageOutbox.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { provider: "RESEND", ...window("sentAt") },
      orderBy: { sentAt: "desc" },
    }));
    expect(prisma.messageProviderEvent.findFirst).toHaveBeenCalledTimes(1);
  });

  it("keeps a failing read to its own row as unavailable", async () => {
    mocks.getPrisma.mockReturnValue(prismaWith({ alertNotification: { findMany: vi.fn().mockRejectedValue(new Error("down")) } }));
    const result = await rows();
    expect(result.find((row) => row.key === "rejected-notices")).toMatchObject({ state: "unavailable", whenLabel: "Tried" });
    expect(result.find((row) => row.key === "square-notices")?.state).toBe("ok");
  });

  it("makes every row unavailable when the database is down", async () => {
    mocks.getPrisma.mockImplementation(() => {
      throw new Error("down");
    });
    const result = await rows();
    expect(result.map((row) => row.state)).toEqual(["unavailable", "unavailable", "unavailable", "unavailable", "unavailable"]);
  });

  it("does not read Square when it is not set up", async () => {
    mocks.getSquareConfiguration.mockReturnValue({ webhookConfigured: false });
    const prisma = prismaWith();
    mocks.getPrisma.mockReturnValue(prisma);
    const result = await rows();
    expect(result[0].state).toBe("info");
    expect(prisma.squareWebhookEvent.findFirst).not.toHaveBeenCalled();
  });

  it("reads SES when it is the active provider", async () => {
    mocks.getActiveEmailProviderName.mockReturnValue("SES");
    const prisma = prismaWith();
    mocks.getPrisma.mockReturnValue(prisma);
    const result = await rows();
    expect(result.find((row) => row.key === "resend-notices")?.state).toBe("info");
    expect(result.find((row) => row.key === "ses-notices")?.state).toBe("ok");
    expect(result.find((row) => row.key === "rejected-notices")?.state).toBe("info");
  });
});
