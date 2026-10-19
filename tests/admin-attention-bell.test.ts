import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getPrisma: vi.fn(),
  getSweepHeartbeat: vi.fn(),
  listDirectoryReviewEntries: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/overview",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("event=event_1"),
}));
vi.mock("@/components/sign-out-button", () => ({ SignOutButton: () => createElement("button", { type: "button" }, "Sign out") }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/logger", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/logger")>()), logError: mocks.logError }));
vi.mock("@/modules/operations/sweep-heartbeat-repository", () => ({ getSweepHeartbeat: mocks.getSweepHeartbeat }));
vi.mock("@/modules/forms/directory-review", () => ({ listDirectoryReviewEntries: mocks.listDirectoryReviewEntries }));

import { GET } from "@/app/api/admin/attention/route";
import { AdminAttentionBell } from "@/components/admin-attention-bell";
import { AppShell } from "@/components/app-shell";
import {
  attentionBadgeText,
  attentionButtonName,
  buildAttentionSummary,
  isSafeAttentionHref,
  type AttentionSignals,
} from "@/modules/system-admin/attention-model";
import { eventCountFromGroups } from "@/modules/system-admin/attention-event-count";
import {
  getAdminAttentionSummary,
  loadAttentionSignals,
  resetAdminAttentionCache,
} from "@/modules/system-admin/attention-repository";

const none = { total: 0, topEventId: null };
const now = new Date("2026-10-19T12:00:00Z");

function signals(overrides: Partial<AttentionSignals> = {}): AttentionSignals {
  return {
    now,
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
  };
}

describe("admin notification bell model (#1032)", () => {
  it("is empty when nothing needs attention", () => {
    const summary = buildAttentionSummary(signals());
    expect(summary).toMatchObject({ total: 0, groups: [], partial: false });
  });

  it("builds each item with the right count, wording and link", () => {
    const summary = buildAttentionSummary(signals({
      clubApplicationsWaiting: 2,
      pendingTeams: { total: 3, topEventId: "evt a" },
      staffInvitationApprovals: { total: 1, topEventId: "evt_b" },
      directoryReview: { total: 4, topEventId: "evt_c" },
      emailFailed: { total: 5, topEventId: "evt_d" },
      emailStuck: { total: 1, topEventId: null },
      outboxSweep: "stale",
      scheduledEmailsOverdue: { total: 1, topEventId: "evt_e" },
      scheduledEmailsFailed: { total: 2, topEventId: "evt_f" },
    }));
    const items = Object.fromEntries(summary.groups.flatMap((group) => group.items).map((item) => [item.key, item]));
    expect(items["club-applications"]).toMatchObject({ count: 2, href: "/admin/clubs/applications", label: "club applications waiting for a decision" });
    expect(items["pending-teams"]).toMatchObject({ count: 3, href: "/people/pending-teams?event=evt%20a" });
    expect(items["staff-invitation-approvals"]).toMatchObject({ count: 1, href: "/people/staff-invitations/approvals?event=evt_b", label: "staff registration waiting for approval" });
    expect(items["directory-review"].href).toBe("/people/directory-review?event=evt_c");
    expect(items["email-failed"].href).toBe("/communications?view=deliveries&event=evt_d");
    expect(items["email-stuck"].href).toBe("/admin");
    expect(items["outbox-sweep"]).toMatchObject({ count: 1, href: "/admin", group: "health" });
    expect(items["scheduled-emails-overdue"].href).toBe("/communications/scheduled?event=evt_e");
    expect(items["scheduled-emails-failed"].href).toBe("/communications/scheduled?event=evt_f");
    expect(summary.groups.map((group) => group.title)).toEqual(["Waiting on staff", "Email problems", "System health"]);
    // The directory-review list (4) is shown but is not part of the badge total.
    expect(items["directory-review"]).toMatchObject({ reviewOnly: true, label: "directory entries to review (a list, not an alert)" });
    expect(summary.total).toBe(2 + 3 + 1 + 5 + 1 + 1 + 1 + 2);
    for (const item of Object.values(items)) expect(isSafeAttentionHref(item.href)).toBe(true);
  });

  it("lists cancellation requests waiting for review with a link to the queue", () => {
    expect(buildAttentionSummary(signals()).groups).toEqual([]);
    const summary = buildAttentionSummary(signals({ cancellationRequestsWaiting: { total: 2, topEventId: "evt_1" } }));
    expect(summary.groups[0].items[0]).toMatchObject({ key: "cancellation-requests", count: 2, href: "/finance/cancellation-requests?status=REQUESTED&event=evt_1" });
  });

  it("shows a sweep problem only when it stopped or failed, not when it has never reported", () => {
    for (const status of ["ok", "never"] as const) expect(buildAttentionSummary(signals({ outboxSweep: status })).groups).toEqual([]);
    expect(buildAttentionSummary(signals({ outboxSweep: "failing" })).groups[0].items[0].label).toContain("failed");
  });

  it("keeps a review-only list out of the badge and the button name", () => {
    const summary = buildAttentionSummary(signals({ directoryReview: { total: 9, topEventId: "e1" } }));
    expect(summary.total).toBe(0);
    expect(summary.groups[0].items[0].count).toBe(9);
  });

  it("flags a partial list when a check could not be read", () => {
    expect(buildAttentionSummary(signals({ unreadableChecks: 1 })).partial).toBe(true);
  });

  it("puts the count in the button's accessible name and caps the badge", () => {
    expect(attentionButtonName(null)).toBe("Notifications");
    expect(attentionButtonName(0)).toBe("Notifications, nothing needs attention");
    expect(attentionButtonName(1)).toBe("Notifications, 1 item needs attention");
    expect(attentionButtonName(7)).toBe("Notifications, 7 items need attention");
    expect(attentionBadgeText(150)).toBe("99+");
    expect(attentionBadgeText(7)).toBe("7");
  });

  it("only treats same-site paths as links", () => {
    expect(isSafeAttentionHref("/admin")).toBe(true);
    expect(isSafeAttentionHref("//evil.example")).toBe(false);
    expect(isSafeAttentionHref("https://evil.example")).toBe(false);
    expect(isSafeAttentionHref("javascript:alert(1)")).toBe(false);
  });
});

describe("admin notification bell counts (#1032)", () => {
  function fakePrisma() {
    const groupBy = (rows: unknown[]) => vi.fn<(args?: unknown) => Promise<unknown[]>>(async () => rows);
    return {
      newClubApplication: { count: vi.fn<(args?: unknown) => Promise<number>>(async () => 2) },
      generalLinkSubmission: { groupBy: groupBy([{ eventId: "e1", _count: { _all: 1 } }, { eventId: "e2", _count: { _all: 4 } }]) },
      staffInvitation: { groupBy: groupBy([{ eventId: "e1", _count: { _all: 3 } }]) },
      event: { findMany: vi.fn<(args?: unknown) => Promise<unknown[]>>(async () => [{ id: "e1" }, { id: "e2" }, { id: "e3" }]) },
      messageOutbox: { groupBy: groupBy([{ eventId: null, _count: { _all: 2 } }, { eventId: "e1", _count: { _all: 1 } }]) },
      scheduledEmailBatch: { groupBy: groupBy([{ eventId: "e2", _count: { _all: 1 } }]) },
      cancellationRequest: { groupBy: groupBy([{ eventId: "e1", _count: { _all: 2 } }, { eventId: "e3", _count: { _all: 1 } }]) },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetAdminAttentionCache();
    mocks.getSweepHeartbeat.mockResolvedValue({ status: "stale" });
    mocks.listDirectoryReviewEntries.mockImplementation(async (eventId: string) => (eventId === "e2" ? [{}, {}] : []));
  });

  it("totals rows and names the busiest event", () => {
    expect(eventCountFromGroups([{ eventId: null, count: 2 }, { eventId: "a", count: 1 }, { eventId: "b", count: 5 }])).toEqual({ total: 8, topEventId: "b" });
    expect(eventCountFromGroups([])).toEqual({ total: 0, topEventId: null });
  });

  it("queries the right status for each count", async () => {
    const prisma = fakePrisma();
    mocks.getPrisma.mockReturnValue(prisma);
    const result = await loadAttentionSignals(now);

    expect(prisma.newClubApplication.count).toHaveBeenCalledWith({ where: { status: "PENDING" } });
    expect(prisma.generalLinkSubmission.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "PENDING" } }));
    expect(prisma.staffInvitation.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { approval: "WAITING" } }));
    expect(prisma.scheduledEmailBatch.groupBy).toHaveBeenCalledTimes(2);
    expect(prisma.cancellationRequest.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "REQUESTED" } }));
    const [failed, providerProblems, stuck] = prisma.messageOutbox.groupBy.mock.calls.map((call) => (call[0] as { where: Record<string, unknown> }).where);
    const since = "2026-10-12T12:00:00.000Z";
    expect(failed.status).toBe("FAILED");
    expect((failed.failedAt as { gte: Date }).gte.toISOString()).toBe(since);
    expect(failed.retries).toEqual({ none: { status: "SENT" } });
    expect(providerProblems).toMatchObject({
      status: { not: "FAILED" },
      provider: { in: ["RESEND", "SES"] },
      providerDeliveryStatus: { in: ["BOUNCED", "COMPLAINED", "FAILED"] },
      retries: { none: { status: "SENT" } },
    });
    expect((providerProblems.providerStatusAt as { gte: Date }).gte.toISOString()).toBe(since);
    expect(stuck.status).toEqual({ in: ["PENDING", "PROCESSING"] });
    expect((stuck.availableAt as { lt: Date }).lt.toISOString()).toBe("2026-10-19T11:30:00.000Z");
    expect(prisma.event.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 11, where: expect.objectContaining({ archivedAt: null }) }));

    expect(result).toMatchObject({
      clubApplicationsWaiting: 2,
      pendingTeams: { total: 5, topEventId: "e2" },
      cancellationRequestsWaiting: { total: 3, topEventId: "e1" },
      staffInvitationApprovals: { total: 3, topEventId: "e1" },
      directoryReview: { total: 2, topEventId: "e2" },
      outboxSweep: "stale",
      unreadableChecks: 0,
    });
  });

  it("keeps going when one check fails and says the list is partial", async () => {
    const prisma = fakePrisma();
    prisma.newClubApplication.count.mockRejectedValue(new Error("db down"));
    mocks.getPrisma.mockReturnValue(prisma);
    const result = await loadAttentionSignals(now);
    expect(result.clubApplicationsWaiting).toBe(0);
    expect(result.unreadableChecks).toBe(1);
    expect(result.pendingTeams.total).toBe(5);
    expect(mocks.logError).toHaveBeenCalled();
  });

  it("counts a failed and a recovered message once each way: the provider query leaves out FAILED originals", async () => {
    const prisma = fakePrisma();
    mocks.getPrisma.mockReturnValue(prisma);
    const result = await loadAttentionSignals(now);
    // Both failed-email reads return rows (fake): total is their sum, with the busiest event named.
    expect(result.emailFailed.total).toBe(6);
  });

  it("flags more events than the directory scan reads as truncated, not as a failed check", async () => {
    const prisma = fakePrisma();
    prisma.event.findMany.mockResolvedValue(Array.from({ length: 11 }, (_, index) => ({ id: `e${index}` })));
    mocks.getPrisma.mockReturnValue(prisma);
    const result = await loadAttentionSignals(now);
    expect(result).toMatchObject({ unreadableChecks: 0, directoryReviewTruncated: true });
    expect(mocks.listDirectoryReviewEntries).toHaveBeenCalledTimes(10);
    expect(buildAttentionSummary(result)).toMatchObject({ partial: false, truncated: true });
  });

  it("runs at most three directory scans at once", async () => {
    const prisma = fakePrisma();
    prisma.event.findMany.mockResolvedValue(Array.from({ length: 10 }, (_, index) => ({ id: `e${index}` })));
    mocks.getPrisma.mockReturnValue(prisma);
    let running = 0;
    let peak = 0;
    mocks.listDirectoryReviewEntries.mockImplementation(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return [];
    });
    await loadAttentionSignals(now);
    expect(mocks.listDirectoryReviewEntries).toHaveBeenCalledTimes(10);
    expect(peak).toBe(3);
  });

  it("marks the list partial when one directory scan fails", async () => {
    const prisma = fakePrisma();
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.listDirectoryReviewEntries.mockRejectedValueOnce(new Error("scan failed"));
    expect((await loadAttentionSignals(now)).unreadableChecks).toBe(1);
  });

  it("still caches a truncated answer for the full window", async () => {
    const prisma = fakePrisma();
    prisma.event.findMany.mockResolvedValue(Array.from({ length: 11 }, (_, index) => ({ id: `e${index}` })));
    mocks.getPrisma.mockReturnValue(prisma);
    const first = await getAdminAttentionSummary(3_000_000);
    expect(first.truncated).toBe(true);
    await getAdminAttentionSummary(3_025_000);
    expect(prisma.newClubApplication.count).toHaveBeenCalledTimes(1);
  });

  it("caches a partial answer only briefly, then reads again", async () => {
    const prisma = fakePrisma();
    prisma.newClubApplication.count.mockRejectedValueOnce(new Error("db down"));
    mocks.getPrisma.mockReturnValue(prisma);
    expect((await getAdminAttentionSummary(2_000_000)).partial).toBe(true);
    await getAdminAttentionSummary(2_005_000);
    expect(prisma.newClubApplication.count).toHaveBeenCalledTimes(1);
    expect((await getAdminAttentionSummary(2_011_000)).partial).toBe(false);
    expect(prisma.newClubApplication.count).toHaveBeenCalledTimes(2);
    await getAdminAttentionSummary(2_040_000);
    expect(prisma.newClubApplication.count).toHaveBeenCalledTimes(2);
  });

  it("shares one answer for the cache window", async () => {
    const prisma = fakePrisma();
    mocks.getPrisma.mockReturnValue(prisma);
    await getAdminAttentionSummary(1_000_000);
    await getAdminAttentionSummary(1_010_000);
    expect(prisma.newClubApplication.count).toHaveBeenCalledTimes(1);
    await getAdminAttentionSummary(1_040_000);
    expect(prisma.newClubApplication.count).toHaveBeenCalledTimes(2);
  });
});

describe("admin notification bell API (#1032)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAdminAttentionCache();
  });

  it.each([
    ["signed out", null],
    ["an event administrator", { id: "u1", globalRole: null }],
  ])("refuses %s without reading any count", async (_name, user) => {
    mocks.getCurrentSession.mockResolvedValue({ user });
    const response = await GET(new Request("http://localhost/api/admin/attention") as never);
    expect(response.status).toBe(403);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("returns the summary to a system administrator, privately cached", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u1", globalRole: "SYSTEM_ADMIN" } });
    mocks.getPrisma.mockReturnValue({
      newClubApplication: { count: vi.fn(async () => 1) },
      generalLinkSubmission: { groupBy: vi.fn(async () => []) },
      staffInvitation: { groupBy: vi.fn(async () => []) },
      event: { findMany: vi.fn(async () => []) },
      messageOutbox: { groupBy: vi.fn(async () => []) },
      scheduledEmailBatch: { groupBy: vi.fn(async () => []) },
      cancellationRequest: { groupBy: vi.fn(async () => []) },
    });
    mocks.getSweepHeartbeat.mockResolvedValue({ status: "ok" });
    const response = await GET(new Request("http://localhost/api/admin/attention") as never);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.attention.total).toBe(1);
    expect(body.attention.groups[0].items[0].href).toBe("/admin/clubs/applications");
  });
});

describe("admin notification bell component (#1032)", () => {
  const summary = buildAttentionSummary(signals({ clubApplicationsWaiting: 2, emailFailed: { total: 1, topEventId: "e1" } }));

  it("names the button with the count and shows a badge", () => {
    const markup = renderToStaticMarkup(createElement(AdminAttentionBell, { initial: summary }));
    expect(markup).toContain('aria-label="Notifications, 3 items need attention"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("Needs attention");
  });

  it("lists each item with its count and a link when open", () => {
    const markup = renderToStaticMarkup(createElement(AdminAttentionBell, { defaultOpen: true, initial: summary }));
    expect(markup).toContain("Waiting on staff");
    expect(markup).toContain("Email problems");
    expect(markup).toContain('href="/admin/clubs/applications"');
    expect(markup).toContain('href="/communications?view=deliveries&amp;event=e1"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('tabindex="-1"');
  });

  it("says so when nothing needs attention, with no badge", () => {
    const markup = renderToStaticMarkup(createElement(AdminAttentionBell, { defaultOpen: true, initial: buildAttentionSummary(signals()) }));
    expect(markup).toContain("Nothing needs attention.");
    expect(markup).toContain('aria-label="Notifications, nothing needs attention"');
    expect(markup).not.toContain("attention-badge");
  });

  it("renders the plain bell before any count is known", () => {
    const markup = renderToStaticMarkup(createElement(AdminAttentionBell));
    expect(markup).toContain('aria-label="Notifications"');
  });
});

describe("admin notification bell in the shell (#1032)", () => {
  function shell(globalRole: "SYSTEM_ADMIN" | null) {
    return renderToStaticMarkup(createElement(AppShell as never, {
      events: [{ id: "event_1", slug: "retreat", name: "Retreat", permissions: [] }],
      user: { displayName: "Casey", email: "casey@imsda-events.test", globalRole },
    }, createElement("p", null, "content")));
  }

  it("shows the bell only to system administrators", () => {
    expect(shell("SYSTEM_ADMIN")).toContain('aria-label="Notifications"');
    expect(shell(null)).not.toContain("Notifications");
  });
});
