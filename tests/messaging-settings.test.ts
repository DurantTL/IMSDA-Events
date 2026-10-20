import { describe, expect, it } from "vitest";
import { messagingSettingsInputSchema } from "@/modules/communications/schemas";

const base = {
  senderName: "IMSDA Women's Retreat",
  replyToEmail: "",
  internalNotificationEmails: [],
};

describe("event email settings (#1043)", () => {
  it("lets an event override its display name and reply-to", () => {
    const parsed = messagingSettingsInputSchema.parse({ ...base, replyToEmail: "retreat@example.test" });
    expect(parsed.senderName).toBe("IMSDA Women's Retreat");
    expect(parsed.replyToEmail).toBe("retreat@example.test");
  });

  it("does not let an event change the From address", () => {
    expect(messagingSettingsInputSchema.safeParse({ ...base, senderEmail: "other@example.test" }).success).toBe(false);
  });

  it("has no delivery switch for event staff", () => {
    for (const deliveryMode of ["DISABLED", "LOCAL_CAPTURE", "EXTERNAL_EMAIL"]) {
      expect(messagingSettingsInputSchema.safeParse({ ...base, deliveryMode }).success).toBe(false);
    }
    expect(messagingSettingsInputSchema.safeParse({ ...base, deliveryPaused: false }).success).toBe(false);
  });
});
