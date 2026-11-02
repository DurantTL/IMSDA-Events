// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams("view=deliveries&status=CAPTURED&page=2"),
  usePathname: () => "/communications",
}));

import { CommunicationsWorkspace } from "@/components/communications-workspace";
import type { MessagingWorkspaceData } from "@/modules/communications/types";
import { buttonByText, flush, mount, type Mounted } from "./helpers/dom-render";

/** After Retry with a filter and a later page active, the new message is shown, selected and in the address (#1492). */
const message = (id: string, subject: string) => ({
  id, templateKey: "CUSTOM_MESSAGE", recipientKind: "REGISTRANT", recipientEmail: `${id}@example.test`, recipientName: "Pat", subject, bodyText: "Text", bodyHtml: null,
  preheader: null, senderName: "Synthetic", senderEmail: "events@example.test", replyToEmail: null, status: "CAPTURED", providerDeliveryStatus: null, providerMessageId: null,
  createdAt: "2026-10-30T12:00:00.000Z", attempts: [], files: [], registration: null, templateVersion: null, clubLinked: false, retryOfMessageId: null, retryRequestFingerprint: "f".repeat(64),
});
function data(messages: unknown[], log: MessagingWorkspaceData["messageLog"]): MessagingWorkspaceData {
  return {
    settings: { deliveryMode: "LOCAL_CAPTURE", deliveryReason: "NOT_CONFIGURED", senderName: "Synthetic", senderEmail: "", centralSenderName: "Synthetic", centralReplyToEmail: "", replyToEmail: "", internalNotificationEmails: [], providerConfigured: false, webhookConfigured: false },
    templates: [], messages: messages as never, messageLog: log, inlineImages: [],
    counts: { PENDING: 0, PROCESSING: 0, CAPTURED: 120, SENT: 0, FAILED: 0, SUPPRESSED: 0, CANCELLED: 0 },
    reminderPreview: {} as never, shirtSizePreview: {} as never,
  };
}

let mounted: Mounted;
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); router.replace.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(async () => { await mounted?.unmount(); vi.unstubAllGlobals(); });

describe("Retry with a status filter and a later page active", () => {
  it("shows the new message, selects it, and puts status All and page 1 in the address", async () => {
    // The action's answer is the log's first page, with every status.
    fetchMock.mockImplementation(async (url: string) => (String(url).endsWith("/retry")
      ? new Response(JSON.stringify({ messaging: data([message("m-new", "Brand new copy"), message("m-old", "Old subject")], { total: 121, page: 1, pageSize: 50, status: "ALL" }), operation: { messageId: "m-new", replayed: false } }))
      : new Response(JSON.stringify({ messaging: data([message("m-old", "Old subject")], { total: 120, page: 2, pageSize: 50, status: "CAPTURED" }) }))));
    mounted = await mount(createElement(CommunicationsWorkspace, {
      eventId: "event-1", eventName: "Synthetic Event", initialAnnouncements: [], canManage: true, initialView: "deliveries",
      initialMessaging: data([message("m-old", "Old subject")], { total: 120, page: 2, pageSize: 50, status: "CAPTURED" }),
    }));
    expect(mounted.container.querySelector(".message-delivery-detail")!.textContent).toContain("Old subject");
    buttonByText(mounted.container, "Capture another audited copy").click();
    await flush();
    await flush();
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual(["/api/events/event-1/messages/m-old/retry"]);
    expect(mounted.container.querySelector(".message-delivery-detail")!.textContent).toContain("Brand new copy");
    const address = String(router.replace.mock.calls.at(-1)![0]);
    expect(address).toContain("message=m-new");
    expect(address).not.toContain("status=");
    expect(address).not.toContain("page=");
  });
});
