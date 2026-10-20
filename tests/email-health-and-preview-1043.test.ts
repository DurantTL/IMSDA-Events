import { describe, expect, it } from "vitest";
import { buildAttentionSummary, type AttentionSignals } from "@/modules/system-admin/attention-model";
import { buildEmailHealth } from "@/modules/system-admin/email-health";
import { buildCentralEmailPreview, formatCentralEmailPreview } from "@/modules/communications/central-email-preview";

const none = { total: 0, topEventId: null };
const signals = (overrides: Partial<AttentionSignals> = {}): AttentionSignals => ({
  now: new Date("2026-10-20T12:00:00Z"),
  clubApplicationsWaiting: 0,
  pendingTeams: none,
  cancellationRequestsWaiting: none,
  staffInvitationApprovals: none,
  directoryReview: none,
  emailFailed: none,
  emailStuck: none,
  outboxSweep: "ok",
  scheduledEmailsOverdue: none,
  scheduledEmailsFailed: none,
  unreadableChecks: 0,
  directoryReviewTruncated: false,
  ...overrides,
});
const provider = { configured: true, webhookConfigured: true, accountEmailConfigured: true, centralSenderSet: true };

describe("email health reuses the bell's computation (#1043)", () => {
  it("lists only email delivery problems, in a fixed order, from the same summary the bell shows", () => {
    const summary = buildAttentionSummary(signals({
      clubApplicationsWaiting: 3,
      emailStuck: { total: 2, topEventId: "event-1" },
      emailFailed: { total: 4, topEventId: "event-2" },
      outboxSweep: "stale",
      scheduledEmailsFailed: { total: 1, topEventId: "event-1" },
    }));
    const health = buildEmailHealth(summary, provider);
    expect(health.problems.map((item) => item.key)).toEqual(["email-failed", "email-stuck", "outbox-sweep", "scheduled-emails-failed"]);
    expect(health.problems[0]).toMatchObject({ count: 4, href: "/communications?view=deliveries&event=event-2" });
    expect(health.windowDays).toBe(7);
    expect(health.partial).toBe(false);
  });

  it("is empty when the bell found nothing, and carries `partial` so an unread check is not shown as all clear", () => {
    expect(buildEmailHealth(buildAttentionSummary(signals()), provider).problems).toEqual([]);
    expect(buildEmailHealth(buildAttentionSummary(signals({ unreadableChecks: 1 })), provider).partial).toBe(true);
  });

  it("keeps provider configuration separate from delivery health", () => {
    const health = buildEmailHealth(buildAttentionSummary(signals()), { ...provider, configured: false });
    expect(health.provider.configured).toBe(false);
    expect(health.problems).toEqual([]);
  });
});

describe("central email migration preview (#1043)", () => {
  const rows = [
    { eventId: "e1", slug: "women-2026", name: "Women's Retreat", deliveryMode: "EXTERNAL_EMAIL" as const, senderEmail: "retreat@imsda-events.test" },
    { eventId: "e2", slug: "camporee", name: "Camporee", deliveryMode: "LOCAL_CAPTURE" as const, senderEmail: "events@imsda-events.test" },
    { eventId: "e3", slug: "old-test", name: "Old test", deliveryMode: "DISABLED" as const, senderEmail: null },
    { eventId: "e4", slug: "fresh", name: "Fresh", deliveryMode: null, senderEmail: null },
    { eventId: "e5", slug: "camp-meeting", name: "Camp Meeting", deliveryMode: "EXTERNAL_EMAIL" as const, senderEmail: "EVENTS@imsda-events.test" },
  ];

  it("counts how each old mode maps: real email stays on, off and capture only become paused", () => {
    const preview = buildCentralEmailPreview(rows, "events@imsda-events.test");
    expect(preview.totals).toEqual({ events: 5, notPaused: 2, pausedFromDisabled: 1, pausedFromLocalCapture: 1, pausedNoSettings: 1 });
    expect(preview.willBePaused.map((event) => event.slug)).toEqual(["camporee", "old-test", "fresh"]);
  });

  it("lists events whose own sender email differs from the central one, ignoring case", () => {
    const preview = buildCentralEmailPreview(rows, "events@imsda-events.test");
    expect(preview.senderEmailDiffers).toEqual([
      { slug: "women-2026", name: "Women's Retreat", deliveryMode: "EXTERNAL_EMAIL", senderEmail: "retreat@imsda-events.test" },
    ]);
  });

  it("says plainly when the central sender is not set, and prints a readable report", () => {
    const text = formatCentralEmailPreview(buildCentralEmailPreview(rows, null));
    expect(text).toContain("NOT SET");
    expect(text).toContain("read-only");
    expect(text).toContain("women-2026");
  });
});
