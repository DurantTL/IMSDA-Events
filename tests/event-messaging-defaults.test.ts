import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  processExternalEmailQueue: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/integrations/email/resend", () => ({
  getResendEmailAvailability: () => ({
    deliveryConfigured: true,
    webhookConfigured: true,
  }),
}));
vi.mock("@/modules/communications/email-delivery", () => ({
  ExternalEmailDeliveryError: class ExternalEmailDeliveryError extends Error {},
  processExternalEmailQueue: mocks.processExternalEmailQueue,
}));

import { ensureEventMessagingDefaults } from "@/modules/communications/messaging-repository";

function harness(platform: Record<string, unknown> | null) {
  const tx = {
    eventMessageSettings: { upsert: vi.fn().mockResolvedValue({}) },
    eventMessageTemplate: {
      upsert: vi.fn().mockResolvedValue({ id: "template-1", versions: [{ id: "version-1" }] }),
    },
    messageTemplateVersion: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    platformSettings: { findUnique: vi.fn().mockResolvedValue(platform) },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  mocks.getPrisma.mockReturnValue(prisma);
  return { tx, prisma };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("new event messaging defaults (#1043)", () => {
  const platform = {
    defaultSenderName: "IMSDA Events",
    defaultSenderEmail: "notifications@imsda.org",
    defaultReplyToEmail: "registration@imsda.org",
  };

  it("starts with the platform display name, and no sender email or reply-to of its own", async () => {
    const { tx } = harness(platform);

    await ensureEventMessagingDefaults("event-1");

    const create = tx.eventMessageSettings.upsert.mock.calls[0]?.[0].create;
    expect(create).toMatchObject({ eventId: "event-1", senderName: "IMSDA Events", replyToEmail: null });
    // The From address is the central one; an event never stores its own (#1043).
    expect(create).not.toHaveProperty("senderEmail");
  });

  it("is not paused: real email is on for a new event wherever it is configured", async () => {
    const { tx } = harness(platform);

    await ensureEventMessagingDefaults("event-1");

    const create = tx.eventMessageSettings.upsert.mock.calls[0]?.[0].create;
    expect(create).not.toHaveProperty("deliveryMode");
    expect(create.deliveryPaused).toBeUndefined();
  });

  it("never rewrites an event whose settings already exist, so a pause survives", async () => {
    const { tx } = harness(platform);

    await ensureEventMessagingDefaults("event-1");

    // An empty update keeps what staff set (display name, reply-to) and what an administrator set (the pause).
    expect(tx.eventMessageSettings.upsert.mock.calls[0]?.[0].update).toEqual({});
  });

  it("falls back to the built-in name when no platform row exists yet", async () => {
    const { tx } = harness(null);

    await ensureEventMessagingDefaults("event-1");

    expect(tx.eventMessageSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ senderName: "IMSDA Events", replyToEmail: null }),
    }));
  });
});
