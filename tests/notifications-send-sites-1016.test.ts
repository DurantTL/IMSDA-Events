import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNotificationEnabled: vi.fn(),
  getPrisma: vi.fn(),
  getAccountEmailSender: vi.fn(),
  isAccountEmailConfigured: vi.fn(),
  getServerEnv: vi.fn(),
  getPlatformSettings: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/notifications/settings", () => ({ isNotificationEnabled: mocks.isNotificationEnabled }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/lib/logger", async () => {
  const actual = await vi.importActual<typeof import("@/lib/logger")>("@/lib/logger");
  return { ...actual, logInfo: mocks.logInfo, logError: mocks.logError };
});
vi.mock("@/modules/system-admin/platform-settings", () => ({ getPlatformSettings: mocks.getPlatformSettings }));
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: vi.fn() }));
vi.mock("@/modules/communications/account-email", async () => {
  const actual = await vi.importActual<typeof import("@/modules/communications/account-email")>("@/modules/communications/account-email");
  return {
    ...actual,
    getAccountEmailSender: mocks.getAccountEmailSender,
    isAccountEmailConfigured: mocks.isAccountEmailConfigured,
  };
});

import { queueSubmittedEmail } from "@/modules/club-applications/email";
import { queueRequestSubmittedEmail } from "@/modules/event-modules/request-email";
import { sendDueLocationWaitlistDigests } from "@/modules/event-locations/waitlist-digest";

const sender = { name: "IMSDA Events", address: "no-reply@imsda-events.test", replyTo: null };

function outbox() {
  return { messageOutbox: { create: vi.fn().mockResolvedValue({ id: "message-1" }) }, adminAlertFeedItem: { createMany: vi.fn().mockResolvedValue({ count: 1 }) } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAccountEmailSender.mockReturnValue(sender);
  mocks.isAccountEmailConfigured.mockReturnValue(true);
  mocks.getServerEnv.mockReturnValue({ APP_BASE_URL: "https://events.imsda-events.test" });
  mocks.isNotificationEnabled.mockResolvedValue(true);
});

describe("new club application notice (#1016)", () => {
  const input = { applicationId: "app-1", clubName: "Synthetic Club", churchName: "Synthetic Church", directorName: "Pat Example" };

  it("queues the notice while its switch is on", async () => {
    const client = outbox();
    expect(await queueSubmittedEmail(client as never, "office@imsda-events.test", input, true)).toEqual(["message-1"]);
    expect(client.messageOutbox.create).toHaveBeenCalledTimes(1);
  });

  it("queues nothing while its switch is off, and never reads the database itself (it runs inside a transaction)", async () => {
    const client = outbox();
    expect(await queueSubmittedEmail(client as never, "office@imsda-events.test", input, false)).toEqual([]);
    expect(client.messageOutbox.create).not.toHaveBeenCalled();
    expect(mocks.isNotificationEnabled).not.toHaveBeenCalled();
  });
});

describe("event feature request notice (#1016)", () => {
  const input = { requestId: "req-1", moduleTitle: "Meals", eventName: "Synthetic Camporee", requesterName: "Pat Example", reason: "We serve meals." };

  it("queues the notice while its switch is on", async () => {
    const client = outbox();
    expect(await queueRequestSubmittedEmail(client as never, "support@imsda-events.test", input, true)).toEqual(["message-1"]);
  });

  it("queues nothing while its switch is off, and never reads the database itself", async () => {
    const client = outbox();
    expect(await queueRequestSubmittedEmail(client as never, "support@imsda-events.test", input, false)).toEqual([]);
    expect(client.messageOutbox.create).not.toHaveBeenCalled();
    expect(mocks.isNotificationEnabled).not.toHaveBeenCalled();
  });
});

describe("location waitlist digest (#1016)", () => {
  const MORNING = new Date("2026-10-06T13:00:00Z"); // 8:00 AM Central, when the digest is due

  it("does nothing, and does not even look at the changes, while its switch is off", async () => {
    mocks.isNotificationEnabled.mockResolvedValue(false);
    const prisma = { locationWaitlistChange: { count: vi.fn() }, $transaction: vi.fn() };
    mocks.getPrisma.mockReturnValue(prisma);

    const result = await sendDueLocationWaitlistDigests(MORNING);

    expect(result.status).toBe("SWITCHED_OFF");
    expect(mocks.isNotificationEnabled).toHaveBeenCalledWith("LOCATION_WAITLIST_DIGEST");
    expect(prisma.locationWaitlistChange.count).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("goes on to look for changes while its switch is on", async () => {
    const prisma = { locationWaitlistChange: { count: vi.fn().mockResolvedValue(0) }, $transaction: vi.fn() };
    mocks.getPrisma.mockReturnValue(prisma);

    const result = await sendDueLocationWaitlistDigests(MORNING);

    expect(result.status).toBe("NO_CHANGES");
    expect(prisma.locationWaitlistChange.count).toHaveBeenCalledTimes(1);
  });
});
