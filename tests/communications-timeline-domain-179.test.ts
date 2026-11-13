import { describe, expect, it } from "vitest";
import {
  contentVisibility,
  messageContentClass,
  messageDeliverySummary,
  messageTypeLabel,
  newestFirst,
  recipientRoleLabel,
} from "@/modules/communications/timeline-domain";

describe("communication timeline content policy (#179)", () => {
  it("classes a health record message as health and everything else as ordinary", () => {
    expect(messageContentClass("HEALTH_RECORD_LINK")).toBe("HEALTH");
    expect(messageContentClass("REGISTRATION_CONFIRMATION_PAID")).toBe("ORDINARY");
    expect(messageContentClass("INVOICE_DELIVERY")).toBe("ORDINARY");
  });

  it("withholds a health message's subject and text without the health permission", () => {
    expect(contentVisibility("HEALTH_RECORD_LINK", ["VIEW_EVENT", "VIEW_SENSITIVE_DATA", "MANAGE_COMMUNICATIONS"])).toEqual({
      contentClass: "HEALTH",
      showSubject: false,
      showBody: false,
    });
    expect(contentVisibility("HEALTH_RECORD_LINK", [])).toMatchObject({ showSubject: false, showBody: false });
  });

  it("shows a health message to a viewer who holds the health permission", () => {
    expect(contentVisibility("HEALTH_RECORD_LINK", ["VIEW_HEALTH_INFORMATION"])).toMatchObject({ showSubject: true, showBody: true });
  });

  it("shows ordinary messages to any viewer", () => {
    expect(contentVisibility("PAYMENT_RECEIPT", [])).toMatchObject({ contentClass: "ORDINARY", showSubject: true, showBody: true });
  });
});

describe("communication timeline labels and order (#179)", () => {
  it("names recipient roles in plain words", () => {
    expect(recipientRoleLabel("REGISTRANT")).toBe("Registrant");
    expect(recipientRoleLabel("INTERNAL")).toBe("Staff notice");
    expect(recipientRoleLabel("BILLING_CONTACT")).toBe("Billing contact");
    expect(recipientRoleLabel("CLUB_DIRECTOR")).toBe("Club director");
    expect(recipientRoleLabel("ACCOUNT")).toBe("Account email");
  });

  it("makes a readable message type", () => {
    expect(messageTypeLabel("REGISTRATION_CONFIRMATION_PAID")).toBe("Registration Confirmation Paid");
  });

  it("orders newest first with the id as tie-break", () => {
    const rows = [
      { id: "a", createdAt: "2026-06-01T00:00:00.000Z" },
      { id: "c", createdAt: "2026-06-02T00:00:00.000Z" },
      { id: "b", createdAt: "2026-06-02T00:00:00.000Z" },
    ];
    expect(newestFirst(rows).map((row) => row.id)).toEqual(["c", "b", "a"]);
  });

  it("keeps the delivery labels and tones", () => {
    const base = { status: "SENT", providerDeliveryStatus: null, createdAt: "c", capturedAt: null, sentAt: "s", deliveredAt: null, failedAt: null };
    expect(messageDeliverySummary(base)).toEqual({ label: "Sent", tone: "green", date: "s" });
    expect(messageDeliverySummary({ ...base, providerDeliveryStatus: "DELIVERED", deliveredAt: "d" })).toEqual({ label: "Delivered", tone: "green", date: "d" });
    expect(messageDeliverySummary({ ...base, status: "FAILED", providerDeliveryStatus: "BOUNCED", failedAt: "f" })).toEqual({ label: "Bounced", tone: "coral", date: "f" });
    expect(messageDeliverySummary({ ...base, status: "PENDING" })).toEqual({ label: "Queued", tone: "gold", date: "c" });
    expect(messageDeliverySummary({ ...base, status: "CAPTURED", capturedAt: "x" })).toEqual({ label: "Captured locally", tone: "purple", date: "x" });
  });
});
