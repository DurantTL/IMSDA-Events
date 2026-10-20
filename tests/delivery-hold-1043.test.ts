import { describe, expect, it } from "vitest";
import { startBlockedNote, suppressionNote } from "@/modules/communications/delivery-hold";

describe("delivery hold guards (#1043)", () => {
  it("records a message as suppressed for a disabled or paused event, and queues it otherwise", () => {
    expect(suppressionNote({ deliveryMode: "DISABLED" })).toBe("Delivery is disabled for this event.");
    expect(suppressionNote({ deliveryMode: "LOCAL_CAPTURE", deliveryReason: "PAUSED" })).toContain("paused");
    expect(suppressionNote({ deliveryMode: "LOCAL_CAPTURE", deliveryReason: "NOT_CONFIGURED" })).toBeNull();
    // A blank central sender queues the message to wait: suppressing it would lose it.
    expect(suppressionNote({ deliveryMode: "EXTERNAL_EMAIL", deliveryReason: "SENDER_MISSING" })).toBeNull();
    expect(suppressionNote({ deliveryMode: "EXTERNAL_EMAIL", deliveryReason: "ON" })).toBeNull();
    expect(suppressionNote(null)).toBeNull();
  });

  it("does not start an offer clock when email is paused, disabled, or waiting for a sender", () => {
    expect(startBlockedNote({ deliveryMode: "LOCAL_CAPTURE", deliveryReason: "PAUSED" })).toContain("paused");
    expect(startBlockedNote({ deliveryMode: "LOCAL_CAPTURE", deliveryReason: "PAUSED" })).toContain("System management > Email");
    expect(startBlockedNote({ deliveryMode: "DISABLED" })).toContain("disabled");
    expect(startBlockedNote({ deliveryMode: "EXTERNAL_EMAIL", deliveryReason: "SENDER_MISSING" })).toContain("central sender address is not set");
  });

  it("lets an offer start when email is on, or captured locally in development", () => {
    expect(startBlockedNote({ deliveryMode: "EXTERNAL_EMAIL", deliveryReason: "ON" })).toBeNull();
    expect(startBlockedNote({ deliveryMode: "LOCAL_CAPTURE", deliveryReason: "NOT_CONFIGURED" })).toBeNull();
    expect(startBlockedNote(null)).toBeNull();
  });
});
