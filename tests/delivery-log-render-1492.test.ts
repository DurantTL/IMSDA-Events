import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/communications",
}));

import { CommunicationsWorkspace } from "@/components/communications-workspace";
import type { MessagingWorkspaceData } from "@/modules/communications/types";

/** The delivery log is paged in the database (#1492): its count line and pager come from the server's total, not from the rows loaded. */
const message = (index: number) => ({
  id: `m-${index}`, templateKey: "REGISTRATION_CONFIRMATION_PAID", recipientKind: "REGISTRANT", recipientEmail: `person${index}@example.test`, recipientName: `Pat ${index}`,
  subject: `Hello ${index}`, bodyText: "Text", bodyHtml: null, preheader: null, senderName: "Synthetic", senderEmail: "events@example.test", replyToEmail: null,
  status: "SENT", providerDeliveryStatus: null, providerMessageId: null, createdAt: "2026-10-30T12:00:00.000Z", attempts: [], files: [], registration: null,
  templateVersion: null, clubLinked: false,
});

function messaging(total: number, page: number, status: "ALL" | "FAILED" = "ALL"): MessagingWorkspaceData {
  return {
    settings: { deliveryMode: "LOCAL_CAPTURE", deliveryReason: "NOT_CONFIGURED", senderName: "Synthetic", senderEmail: "", centralSenderName: "Synthetic", centralReplyToEmail: "", replyToEmail: "", internalNotificationEmails: [], providerConfigured: false, webhookConfigured: false },
    templates: [],
    messages: [message(1), message(2)] as never,
    messageLog: { total, page, pageSize: 2, status },
    inlineImages: [],
    counts: { PENDING: 0, PROCESSING: 0, CAPTURED: 0, SENT: total, FAILED: 0, SUPPRESSED: 0, CANCELLED: 0 },
    reminderPreview: {} as never,
    shirtSizePreview: {} as never,
  };
}

const render = (data: MessagingWorkspaceData) => renderToStaticMarkup(createElement(CommunicationsWorkspace, {
  eventId: "event-1", eventName: "Synthetic Event", initialAnnouncements: [], initialMessaging: data, canManage: true, initialView: "deliveries",
}));

describe("the delivery log count line and pager", () => {
  it("shows the real total and page, so every message beyond the first 150 is reachable", () => {
    const html = render(messaging(400, 3));
    expect(html).toContain("Showing 5–6 of 400 messages");
    expect(html).toContain("Page 3 of 200");
    expect(html).not.toMatch(/holds the newest|aren&#x27;t loaded|older messages/i);
  });

  it("labels the Delivery log tab with every message, not the rows loaded", () => {
    expect(render(messaging(400, 1))).toMatch(/Delivery log[^<]*<span>400<\/span>/);
  });

  it("marks the filter the server applied", () => {
    const html = render(messaging(7, 1, "FAILED"));
    expect(html).toMatch(/aria-pressed="true"[^>]*>Failed|class="active"[^>]*>Failed/);
  });
});
