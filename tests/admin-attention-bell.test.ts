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
import {
  eventCountFromGroups,
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
    cancellationRequestsWaiting: null,
    staffInvitationApprovals: none,
    directoryReview: none,
    emailFailed: none,
    emailStuck: none,
    outboxSweep: "ok",
    scheduledEmailsOverdue: none,
    scheduledEmailsFailed: none,
    unreadableChecks: 0,
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
    expect(summary.total).toBe(2 + 3 + 1 + 4 + 5 + 1 + 1 + 1 + 2);
    for (const item of Object.values(items)) expect(isSafeAttentionHref(item.href)).toBe(true);
  });

  it("leaves out cancellation requests until the hook supplies them, then lists them", () => {
    expect(buildAttentionSummary(signals()).groups).toEqual([]);
    const withHook = buildAttentionSummary(signals({ cancellationRequestsWaiting: { total: 2, topEventId: "evt_1" } }));
    expect(withHook.groups[0].items[0]).toMatchObject({ key: "cancellation-requests", count: 2 });
  });

  it("shows a sweep problem only when it stopped or failed, not when it has never reported", () => {
    for (const status of ["ok", "never"] as const) expect(buildAttentionSummary(signals({ outboxSweep: status })).groups).toEqual([]);
    expect(buildAttentionSummary(signals({ outboxSweep: "failing" })).groups[0].items[0].label).toContain("failed");
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
    const groupBy = (rows: unknown[]) => vi.fn(async (_args: unknown) => rows);
    return {
      newClubApplication: { count: vi.fn(async (_args: unknown) => 2) },
      generalLinkSubmission: { groupBy: groupBy([{ eventId: "e1", _count: { _all: 1 } }, { eventId: "e2", _count: { _all: 4 } }]) },
      staffInvitation: { groupBy: groupBy([{ eventId: "e1", _count: { _all: 3 } }]) },
      event: { findMany: vi.fn(async (_args: unknown) => [{ id: "e1" }, { id: "e2" }, { id: "e3" }]) },
      messageOutbox: { groupBy: groupBy([{ eventId: null, _count: { _all: 2 } }, { eventId: "e1", _count: { _all: 1 } }]) },
      scheduledEmailBatch: { groupBy: groupBy([{ eventId: "e2", _count: { _all: 1 } }]) },
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
    const [failed, stuck] = prisma.messageOutbox.groupBy.mock.calls.map((call) => (call[0] as { where: Record<string, unknown> }).where);
    expect(failed.OR).toEqual([{ status: "FAILED" }, { providerDeliveryStatus: { in: ["BOUNCED", "COMPLAINED", "FAILED"] } }]);
    expect((failed.updatedAt as { gte: Date }).gte.toISOString()).toBe("2026-10-12T12:00:00.000Z");
    expect(stuck.status).toEqual({ in: ["PENDING", "PROCESSING"] });
    expect((stuck.availableAt as { lt: Date }).lt.toISOString()).toBe("2026-10-19T11:30:00.000Z");
    expect(prisma.event.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10, where: expect.objectContaining({ archivedAt: null }) }));

    expect(result).toMatchObject({
      clubApplicationsWaiting: 2,
      pendingTeams: { total: 5, topEventId: "e2" },
      cancellationRequestsWaiting: null,
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
    const response = await GET(new Request("http://localhost/api/admin/attention") as never, undefined as never);
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
    });
    mocks.getSweepHeartbeat.mockResolvedValue({ status: "ok" });
    const response = await GET(new Request("http://localhost/api/admin/attention") as never, undefined as never);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=30");
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
