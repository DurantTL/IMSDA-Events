import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isEmailPrimarySes: vi.fn(),
  suppressAddress: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/email/provider", () => ({ isEmailPrimarySes: mocks.isEmailPrimarySes }));
vi.mock("@/modules/communications/email-suppression", () => ({ suppressAddress: mocks.suppressAddress }));
vi.mock("@/modules/club-forms/link-email", () => ({ retireClubFormLinkForMessage: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    messageProviderEvent: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})) },
    messageOutbox: { findUnique: vi.fn(async () => ({ id: "message-1" })), updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  return { getPrisma: () => ({ $transaction: async (operation: (client: typeof tx) => unknown) => operation(tx) }) };
});

import { recordResendWebhookEvent, resendSuppression } from "@/modules/communications/resend-webhook-repository";

/** #1444: Resend bounces and complaints feed the same do-not-send list as SES, once the SES + Resend backup is set up. */

const event = (type: string, to: unknown = ["Attendee@Example.test"]) => ({
  type,
  created_at: "2026-11-01T12:00:00.000Z",
  data: { email_id: "email-provider-1", to },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isEmailPrimarySes.mockReturnValue(true);
});

describe("what a Resend event suppresses", () => {
  it("a bounce or a complaint suppresses its recipients, normalized", () => {
    expect(resendSuppression(event("email.bounced"))).toEqual({ reason: "BOUNCE", recipients: ["attendee@example.test"] });
    expect(resendSuppression(event("email.complained", ["Name <Parent@Example.test>", "parent@example.test"]))).toEqual({ reason: "COMPLAINT", recipients: ["parent@example.test"] });
  });

  it("a bounce that is not permanent suppresses nothing, a permanent or untyped one does, a complaint always does", () => {
    const typed = (type: string, kind = "email.bounced") => ({ ...event(kind), data: { email_id: "e", to: ["a@example.test"], bounce: { type } } });
    expect(resendSuppression(typed("Transient"))).toBeNull();
    expect(resendSuppression(typed("Undetermined"))).toBeNull();
    expect(resendSuppression(typed("Permanent"))).toMatchObject({ reason: "BOUNCE" });
    expect(resendSuppression(event("email.bounced"))).toMatchObject({ reason: "BOUNCE" });
    expect(resendSuppression(typed("Transient", "email.complained"))).toMatchObject({ reason: "COMPLAINT" });
  });

  it("nothing else suppresses, and nothing is guessed from a missing or odd recipient list", () => {
    expect(resendSuppression(event("email.delivered"))).toBeNull();
    expect(resendSuppression(event("email.delivery_delayed"))).toBeNull();
    expect(resendSuppression(event("email.bounced", null))).toBeNull();
    expect(resendSuppression(event("email.bounced", ["not an address", 7]))).toBeNull();
  });
});

describe("the Resend webhook and the shared list", () => {
  it("records the suppression in the same table the SES notices use, tagged with its provider", async () => {
    await recordResendWebhookEvent("webhook-1", event("email.bounced"));
    expect(mocks.suppressAddress).toHaveBeenCalledTimes(1);
    expect(mocks.suppressAddress).toHaveBeenCalledWith(expect.anything(), {
      normalizedEmail: "attendee@example.test",
      reason: "BOUNCE",
      provider: "RESEND",
      occurredAt: new Date("2026-11-01T12:00:00.000Z"),
      sourceProviderEventId: "webhook-1",
      sourceMessageOutboxId: "message-1",
    });
  });

  it("leaves a server that uses Resend alone exactly as it was", async () => {
    mocks.isEmailPrimarySes.mockReturnValue(false);
    await recordResendWebhookEvent("webhook-2", event("email.complained"));
    expect(mocks.suppressAddress).not.toHaveBeenCalled();
  });
});
