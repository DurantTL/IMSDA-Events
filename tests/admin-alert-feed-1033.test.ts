import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The system administrator alert feed (#1033, slice 2 of the notification bell). Synthetic data only.
 *
 * The feed's database is a small in-memory fake that understands exactly the filters `feed.ts` uses, so the read state,
 * the mark-all cutoff and the 90-day window are tested as behavior, not as call shapes.
 */

type Item = { id: string; notificationKey: string; occurrenceKey: string; summary: string; href: string | null; occurredAt: Date };

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  getCurrentSession: vi.fn(),
  getServerEnv: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/overview",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/env")>()), getServerEnv: mocks.getServerEnv }));
vi.mock("@/lib/logger", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/logger")>()), logError: mocks.logError }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));

import { GET, POST } from "@/app/api/admin/alert-feed/route";
import { AdminAttentionBell } from "@/components/admin-attention-bell";
import { notificationCatalog } from "@/modules/notifications/catalog";
import {
  ALERT_FEED_RETENTION_DAYS,
  alertsOnlyButtonName,
  announcementText,
  feedAnnouncement,
  formatFeedTime,
  alertFeedCutoff,
  cleanFeedSummary,
  safeFeedHref,
  type AlertFeed,
} from "@/modules/notifications/feed-model";
import {
  countUnreadAlertFeed,
  listAlertFeed,
  markAlertFeedItemRead,
  markAllAlertFeedRead,
  pruneAlertFeed,
  recordAlertFeedItem,
} from "@/modules/notifications/feed";
import { buildAttentionSummary, type AttentionSignals } from "@/modules/system-admin/attention-model";

const DAY = 24 * 60 * 60_000;
const NOW = new Date("2026-11-30T12:00:00.000Z");

type Where = {
  id?: string | { in: string[] };
  occurredAt?: { gte?: Date; lte?: Date; lt?: Date };
  receipts?: { none: { userId: string } };
};

/** A fake of the two feed tables. `createMany` honors `skipDuplicates` on the unique occurrence key, like Postgres. */
function fakeFeedDatabase() {
  const items: Item[] = [];
  const receipts = new Set<string>();
  let nextId = 1;
  const matches = (item: Item, where: Where) => {
    if (typeof where.id === "string" && item.id !== where.id) return false;
    if (typeof where.id === "object" && !where.id.in.includes(item.id)) return false;
    const range = where.occurredAt;
    if (range?.gte && item.occurredAt < range.gte) return false;
    if (range?.lte && item.occurredAt > range.lte) return false;
    if (range?.lt && !(item.occurredAt < range.lt)) return false;
    if (where.receipts && receipts.has(`${item.id}:${where.receipts.none.userId}`)) return false;
    return true;
  };
  const prisma = {
    adminAlertFeedItem: {
      createMany: vi.fn(async ({ data, skipDuplicates }: { data: Array<Omit<Item, "id" | "occurredAt"> & { occurredAt?: Date }>; skipDuplicates?: boolean }) => {
        let count = 0;
        for (const row of data) {
          if (items.some((item) => item.occurrenceKey === row.occurrenceKey)) {
            if (skipDuplicates) continue;
            throw new Error("Unique constraint failed");
          }
          items.push({ ...row, id: `item-${nextId++}`, occurredAt: row.occurredAt ?? NOW });
          count += 1;
        }
        return { count };
      }),
      count: vi.fn(async ({ where }: { where: Where }) => items.filter((item) => matches(item, where)).length),
      findFirst: vi.fn(async ({ where }: { where: Where }) => items.find((item) => matches(item, where)) ?? null),
      findMany: vi.fn(async ({ where, take, select }: { where: Where; take?: number; select: { receipts?: { where: { userId: string } } } }) => {
        const found = items.filter((item) => matches(item, where))
          .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id))
          .slice(0, take ?? items.length);
        const userId = select.receipts?.where.userId;
        return found.map((item) => ({ ...item, receipts: userId && receipts.has(`${item.id}:${userId}`) ? [{ userId }] : [] }));
      }),
      deleteMany: vi.fn(async ({ where }: { where: Where }) => {
        const doomed = items.filter((item) => matches(item, where));
        for (const item of doomed) {
          items.splice(items.indexOf(item), 1);
          for (const key of [...receipts]) if (key.startsWith(`${item.id}:`)) receipts.delete(key);
        }
        return { count: doomed.length };
      }),
    },
    adminAlertFeedReceipt: {
      createMany: vi.fn(async ({ data }: { data: Array<{ itemId: string; userId: string }>; skipDuplicates?: boolean }) => {
        let count = 0;
        for (const row of data) {
          const key = `${row.itemId}:${row.userId}`;
          if (receipts.has(key)) continue;
          receipts.add(key);
          count += 1;
        }
        return { count };
      }),
    },
  };
  /** Seeds an item at a time. */
  const seed = (key: string, at: Date, summary = "A synthetic alert.") => {
    items.push({ id: `item-${nextId++}`, notificationKey: "NEW_CLUB_APPLICATION", occurrenceKey: key, summary, href: "/admin", occurredAt: at });
    return items[items.length - 1]!;
  };
  return { prisma, items, receipts, seed };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getServerEnv.mockReturnValue({ APP_BASE_URL: "http://localhost" });
});

describe("feed rules (#1033)", () => {
  it("sets the cutoff 90 days before now", () => {
    expect(ALERT_FEED_RETENTION_DAYS).toBe(90);
    const cutoff = alertFeedCutoff(NOW);
    expect(cutoff.getTime()).toBe(NOW.getTime() - 90 * DAY);
  });

  it("removes template braces and control characters and caps the length", () => {
    expect(cleanFeedSummary("  A  {{secret}}\n\tthing  ")).toBe("A secret thing");
    expect(cleanFeedSummary("x".repeat(400)).length).toBeLessThanOrEqual(160);
  });

  it("stores only an internal path, never an absolute address or one carrying a token", () => {
    expect(safeFeedHref("/admin/clubs/applications")).toBe("/admin/clubs/applications");
    expect(safeFeedHref("//evil.example")).toBeNull();
    expect(safeFeedHref("https://evil.example/x")).toBeNull();
    expect(safeFeedHref("/clubs/register?token=abc")).toBeNull();
    expect(safeFeedHref(null)).toBeNull();
  });
});

describe("writing an item (#1033)", () => {
  it("writes one row, cleaned, and a repeat of the same occurrence writes nothing more", async () => {
    const db = fakeFeedDatabase();
    const write = { notificationKey: "NEW_CLUB_APPLICATION" as const, occurrenceKey: "new-club-application:a1", summary: "A new club application {{x}} was submitted.", href: "https://evil.example" };
    await recordAlertFeedItem(db.prisma as never, write);
    await recordAlertFeedItem(db.prisma as never, write);
    expect(db.items).toHaveLength(1);
    expect(db.items[0]).toMatchObject({ summary: "A new club application x was submitted.", href: null });
    expect(db.prisma.adminAlertFeedItem.createMany.mock.calls[0]![0].skipDuplicates).toBe(true);
  });
});

describe("read and unread per administrator (#1033)", () => {
  it("keeps one administrator's reads from changing another's", async () => {
    const db = fakeFeedDatabase();
    mocks.getPrisma.mockReturnValue(db.prisma);
    const a = db.seed("k1", new Date(NOW.getTime() - 1000));
    db.seed("k2", new Date(NOW.getTime() - 2000));

    expect(await markAlertFeedItemRead("admin-1", a.id, NOW)).toBe(true);
    // Idempotent: reading it again changes nothing.
    expect(await markAlertFeedItemRead("admin-1", a.id, NOW)).toBe(true);

    expect(await countUnreadAlertFeed("admin-1", NOW)).toBe(1);
    expect(await countUnreadAlertFeed("admin-2", NOW)).toBe(2);
    const second = await listAlertFeed("admin-2", NOW);
    expect(second.items.every((item) => !item.read)).toBe(true);
    const first = await listAlertFeed("admin-1", NOW);
    expect(first.items.find((item) => item.id === a.id)?.read).toBe(true);
    expect(first.unreadCount).toBe(1);
    expect(db.receipts.size).toBe(1);
  });

  it("cannot mark an item that is gone or expired", async () => {
    const db = fakeFeedDatabase();
    mocks.getPrisma.mockReturnValue(db.prisma);
    const old = db.seed("old", new Date(NOW.getTime() - 91 * DAY));
    expect(await markAlertFeedItemRead("admin-1", old.id, NOW)).toBe(false);
    expect(await markAlertFeedItemRead("admin-1", "missing", NOW)).toBe(false);
  });

  it("marks only the items that were shown: one that arrived or committed since stays unread, even with an older timestamp", async () => {
    const db = fakeFeedDatabase();
    mocks.getPrisma.mockReturnValue(db.prisma);
    const shownOne = db.seed("k1", new Date(NOW.getTime() - 3000));
    const shownTwo = db.seed("k2", new Date(NOW.getTime() - 2000));
    // Stamped before the panel loaded but committed after it: older than the newest shown item, never shown.
    const unseen = db.seed("slow-commit", new Date(NOW.getTime() - 2500));

    const marked = await markAllAlertFeedRead("admin-1", [shownOne.id, shownTwo.id], NOW);
    expect(marked).toBe(2);
    const after = await listAlertFeed("admin-1", NOW);
    expect(after.unreadCount).toBe(1);
    expect(after.items.find((item) => !item.read)?.id).toBe(unseen.id);
    expect(await countUnreadAlertFeed("admin-2", NOW)).toBe(3);
  });

  it("ignores ids that are unknown or past 90 days, and ids another administrator has no claim on", async () => {
    const db = fakeFeedDatabase();
    mocks.getPrisma.mockReturnValue(db.prisma);
    const expired = db.seed("expired", new Date(NOW.getTime() - 91 * DAY));
    const live = db.seed("live", new Date(NOW.getTime() - 1000));
    expect(await markAllAlertFeedRead("admin-1", ["missing", expired.id], NOW)).toBe(0);
    expect(db.receipts.size).toBe(0);
    expect(await markAllAlertFeedRead("admin-1", [live.id, live.id, expired.id], NOW)).toBe(1);
    // Marking again is idempotent.
    expect(await markAllAlertFeedRead("admin-1", [live.id], NOW)).toBe(0);
    expect(await markAllAlertFeedRead("admin-1", [], NOW)).toBe(0);
  });
});

describe("retention (#1033)", () => {
  it("hides items older than 90 days from the list and the count, and keeps one exactly 90 days old", async () => {
    const db = fakeFeedDatabase();
    mocks.getPrisma.mockReturnValue(db.prisma);
    db.seed("edge", new Date(NOW.getTime() - 90 * DAY));
    db.seed("expired", new Date(NOW.getTime() - 90 * DAY - 1));
    const feed = await listAlertFeed("admin-1", NOW);
    expect(feed.items).toHaveLength(1);
    expect(feed.unreadCount).toBe(1);
  });

  it("deletes only expired items, with their read receipts", async () => {
    const db = fakeFeedDatabase();
    mocks.getPrisma.mockReturnValue(db.prisma);
    const keep = db.seed("keep", new Date(NOW.getTime() - 89 * DAY));
    const expired = db.seed("expired", new Date(NOW.getTime() - 91 * DAY));
    db.receipts.add(`${expired.id}:admin-1`);
    db.receipts.add(`${keep.id}:admin-1`);
    expect(await pruneAlertFeed(NOW)).toBe(1);
    expect(db.items.map((item) => item.occurrenceKey)).toEqual(["keep"]);
    expect([...db.receipts]).toEqual([`${keep.id}:admin-1`]);
  });
});

describe("the feed API (#1033)", () => {
  const post = (body: unknown, headers: Record<string, string> = { origin: "http://localhost" }) =>
    POST(new Request("http://localhost/api/admin/alert-feed", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }) as never);

  it.each([
    ["signed out", null],
    ["an event administrator", { id: "u1", globalRole: null }],
    ["a staff member", { id: "u2", globalRole: "STAFF" }],
  ])("refuses %s on every method without touching the database", async (_name, user) => {
    mocks.getCurrentSession.mockResolvedValue({ user });
    expect((await GET(new Request("http://localhost/api/admin/alert-feed") as never)).status).toBe(403);
    expect((await post({ action: "read-all", ids: ["x"] })).status).toBe(403);
    expect((await post({ action: "read", id: "x" })).status).toBe(403);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin post before anything else", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
    const response = await post({ action: "read-all", ids: ["x"] }, { origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("lists, marks one read and marks all read for the signed-in administrator only, privately cached", async () => {
    const db = fakeFeedDatabase();
    mocks.getPrisma.mockReturnValue(db.prisma);
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
    const recent = new Date(Date.now() - 60_000);
    const first = db.seed("k1", recent);
    db.seed("k2", new Date(recent.getTime() - 1000));

    const listed = await GET(new Request("http://localhost/api/admin/alert-feed") as never);
    expect(listed.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await listed.json()).feed.unreadCount).toBe(2);

    const one = await (await post({ action: "read", id: first.id })).json();
    expect(one.feed.unreadCount).toBe(1);

    const all = await (await post({ action: "read-all", ids: [first.id, "item-2"] })).json();
    expect(all.feed.unreadCount).toBe(0);
    expect(await countUnreadAlertFeed("admin-2")).toBe(2);
  });

  it("says an expired or unknown item is unavailable, and refuses a malformed request", async () => {
    const db = fakeFeedDatabase();
    mocks.getPrisma.mockReturnValue(db.prisma);
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
    expect((await post({ action: "read", id: "missing" })).status).toBe(404);
    expect((await post({ action: "read-all" })).status).toBe(400);
    expect((await post({ action: "read-all", ids: [] })).status).toBe(400);
    expect((await post({ action: "read-all", ids: Array.from({ length: 500 }, (_, index) => `id-${index}`) })).status).toBe(400);
    expect((await post({ action: "delete-everything" })).status).toBe(400);
    expect((await post({ action: "read", id: "x", extra: true })).status).toBe(400);
  });
});

describe("what each alert writes (#1033)", () => {
  /** Every built catalog alert names itself in a feed write, so none can be added without one. */
  it("has a feed write for every built alert in the catalog", () => {
    const files = [
      "modules/club-applications/email.ts",
      "modules/communications/lockout-email.ts",
      "modules/communications/messaging-repository.ts",
      "modules/registration-pdf/notices.ts",
      "modules/event-modules/request-email.ts",
      "modules/general-link-registrations/repository.ts",
      "modules/staff-invitations/repository.ts",
      "modules/club-teams/permission-repository.ts",
      "modules/event-locations/waitlist-digest.ts",
      "modules/club-transfers/repository.ts",
      "modules/club-forms/submission-alert.ts",
      "modules/information-forms/submission-alert.ts",
      "modules/registration-form-notifications/queue.ts",
      "modules/honors/class-change-emails.ts",
      "modules/honors/watch-emails.ts",
    ];
    const text = files.map((file) => readFileSync(file, "utf8")).join("\n");
    for (const entry of notificationCatalog.filter((alert) => alert.built)) {
      const direct = text.includes(`notificationKey: "${entry.key}"`);
      // The two transfer notices share one queueing function that passes its own template key.
      const viaTemplate = entry.key.startsWith("MEMBER_TRANSFER_") && text.includes("notificationKey: templateKey") && text.includes(`"${entry.key}"`);
      expect(direct || viaTemplate, `${entry.key} writes no feed item`).toBe(true);
    }
  });
});

describe("the club application and feature request alerts write beside the email (#1033)", () => {
  const sender = { name: "IMSDA Events", address: "no-reply@imsda-events.test", replyTo: null };

  beforeEach(() => {
    vi.resetModules();
  });

  async function load() {
    vi.doMock("@/modules/communications/account-email", async () => {
      const actual = await vi.importActual<typeof import("@/modules/communications/account-email")>("@/modules/communications/account-email");
      return { ...actual, getAccountEmailSender: () => sender, isAccountEmailConfigured: () => true };
    });
    vi.doMock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: vi.fn() }));
    vi.doMock("@/modules/system-admin/platform-settings", () => ({ getPlatformSettings: vi.fn() }));
    const club = await import("@/modules/club-applications/email");
    const request = await import("@/modules/event-modules/request-email");
    return { club, request };
  }

  function client() {
    const db = fakeFeedDatabase();
    return {
      db,
      tx: {
        messageOutbox: { create: vi.fn(async () => ({ id: "message-1" })) },
        adminAlertFeedItem: db.prisma.adminAlertFeedItem,
      },
    };
  }

  const application = { applicationId: "app-1", clubName: "Synthetic Club", churchName: "Synthetic Church", directorName: "Pat Example" };
  const featureRequest = { requestId: "req-1", moduleTitle: "Meals", eventName: "Synthetic Camporee", requesterName: "Casey Example", reason: "We serve meals to forty guests." };

  it("writes the feed item with the email, once however often it is retried", async () => {
    const { club } = await load();
    const { tx, db } = client();
    await club.queueSubmittedEmail(tx as never, "office@imsda-events.test", application, true);
    await club.queueSubmittedEmail(tx as never, "office@imsda-events.test", application, true);
    expect(tx.messageOutbox.create).toHaveBeenCalledTimes(2);
    expect(db.items).toHaveLength(1);
    expect(db.items[0]).toMatchObject({ notificationKey: "NEW_CLUB_APPLICATION", occurrenceKey: "new-club-application:app-1", href: "/admin/clubs/applications" });
  });

  it("writes neither the email nor the item while the switch is off, there is no address, or no sender", async () => {
    const { club, request } = await load();
    const { tx, db } = client();
    await club.queueSubmittedEmail(tx as never, "office@imsda-events.test", application, false);
    await club.queueSubmittedEmail(tx as never, null, application, true);
    await request.queueRequestSubmittedEmail(tx as never, "office@imsda-events.test", featureRequest, false);
    await request.queueRequestSubmittedEmail(tx as never, null, featureRequest, true);
    expect(tx.messageOutbox.create).not.toHaveBeenCalled();
    expect(db.items).toHaveLength(0);
  });

  it("rolls back with the email: a failed email write leaves no item behind", async () => {
    const { club } = await load();
    const { tx, db } = client();
    tx.messageOutbox.create.mockRejectedValueOnce(new Error("outbox write failed"));
    await expect(club.queueSubmittedEmail(tx as never, "office@imsda-events.test", application, true)).rejects.toThrow("outbox write failed");
    expect(db.items).toHaveLength(0);
  });

  it("writes the feature request item with the email", async () => {
    const { request } = await load();
    const { tx, db } = client();
    await request.queueRequestSubmittedEmail(tx as never, "office@imsda-events.test", featureRequest, true);
    expect(db.items).toHaveLength(1);
    expect(db.items[0]).toMatchObject({ notificationKey: "EVENT_MODULE_REQUESTED", occurrenceKey: "module-request:req-1" });
  });

  it("keeps names, reasons and free text out of every summary", async () => {
    const { club, request } = await load();
    const { tx, db } = client();
    await club.queueSubmittedEmail(tx as never, "office@imsda-events.test", application, true);
    await request.queueRequestSubmittedEmail(tx as never, "office@imsda-events.test", featureRequest, true);
    const stored = JSON.stringify(db.items);
    for (const sensitive of ["Pat Example", "Casey Example", "Synthetic Church", "Synthetic Club", "Synthetic Camporee", "forty guests", "office@imsda-events.test"]) {
      expect(stored).not.toContain(sensitive);
    }
  });
});

describe("the bell with the feed (#1033)", () => {
  const none = { total: 0, topEventId: null };
  const signals: AttentionSignals = {
    now: NOW, clubApplicationsWaiting: 2, pendingTeams: none, cancellationRequestsWaiting: none, staffInvitationApprovals: none,
    directoryReview: none, emailFailed: none, emailStuck: none, outboxSweep: "ok", scheduledEmailsOverdue: none, scheduledEmailsFailed: none,
    unreadableChecks: 0, directoryReviewTruncated: false,
  };
  const summary = buildAttentionSummary(signals);
  const feed: AlertFeed = {
    unreadCount: 2,
    items: [
      { id: "i1", notificationKey: "NEW_CLUB_APPLICATION", alertName: "New club application submitted", summary: "A new club application was submitted and is waiting for a decision.", href: "/admin/clubs/applications", occurredAt: NOW.toISOString(), read: false },
      { id: "i2", notificationKey: "EVENT_MODULE_REQUESTED", alertName: "Event feature requested", summary: "An event admin asked for the Meals feature to be turned on.", href: null, occurredAt: NOW.toISOString(), read: true },
    ],
  };

  it("adds unread alerts to the live counts in the badge and the button's name", () => {
    const markup = renderToStaticMarkup(createElement(AdminAttentionBell, { initial: summary, initialFeed: feed }));
    expect(markup).toContain('aria-label="Notifications, 4 items need attention"');
  });

  it("shows the feed apart from the live counts, with a mark-read button only for an unread item", () => {
    const markup = renderToStaticMarkup(createElement(AdminAttentionBell, { defaultOpen: true, initial: summary, initialFeed: feed }));
    expect(markup).toContain("Needs attention");
    expect(markup).toContain("Recent alerts, 2 unread");
    expect(markup).toContain("New club application submitted");
    expect(markup).toContain('aria-label="Mark read: New club application submitted, A new club application was submitted and is waiting for a decision. (');
    expect(markup).not.toContain('aria-label="Mark read: Event feature requested');
    // A polite live region announces the result of marking read.
    expect(markup).toContain('aria-live="polite"');
    // Focus has a place to go when the pressed button disappears.
    expect(markup).toMatch(/<h3[^>]*tabindex="-1"[^>]*>Recent alerts/);
    // The feed says 2 unread but one is shown, so the button does not claim to mark all.
    expect(markup).toContain("Mark these read");
    // An item with no link is plain text, not a link.
    expect(markup).toContain("Event feature requested");
  });

  it("gives every mark-read button its own name, even for two alerts of one kind", () => {
    const twin = { ...feed.items[0]!, id: "i3", summary: "A new club application was submitted and is waiting for a decision.", occurredAt: new Date(NOW.getTime() - 3_600_000).toISOString() };
    const markup = renderToStaticMarkup(createElement(AdminAttentionBell, { defaultOpen: true, initial: summary, initialFeed: { unreadCount: 3, items: [...feed.items, twin] } }));
    const names = [...markup.matchAll(/aria-label="(Mark read: [^"]*)"/g)].map((match) => match[1]);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it("keeps the plain bell name when the live counts could not be read, rather than saying nothing needs attention", () => {
    const markup = renderToStaticMarkup(createElement(AdminAttentionBell, { initialFeed: { unreadCount: 0, items: [] } }));
    expect(markup).toContain('aria-label="Notifications"');
    expect(markup).not.toContain("nothing needs attention");
  });

  it("names and badges the alerts alone when the live counts failed but the feed has unread alerts", () => {
    const markup = renderToStaticMarkup(createElement(AdminAttentionBell, { initialFeed: { unreadCount: 3, items: [] } }));
    expect(markup).toContain('aria-label="Notifications, 3 unread alerts"');
    expect(markup).toContain("attention-badge");
    expect(alertsOnlyButtonName(1)).toBe("Notifications, 1 unread alert");
    // Both unknown or nothing unread: the plain name, no badge.
    expect(renderToStaticMarkup(createElement(AdminAttentionBell))).toContain('aria-label="Notifications"');
    expect(renderToStaticMarkup(createElement(AdminAttentionBell, { initialFeed: { unreadCount: 0, items: [] } }))).not.toContain("attention-badge");
  });

  it("announces what the button said, and announces a repeat again", () => {
    expect(feedAnnouncement("read", false)).toBe("Marked read");
    expect(feedAnnouncement("read-all", false)).toBe("All alerts marked read");
    expect(feedAnnouncement("read-all", true)).toBe("Shown alerts marked read");
    const first = announcementText("Marked read", 1);
    const second = announcementText("Marked read", 2);
    expect(first).not.toBe(second);
    expect(announcementText("", 3)).toBe("");
  });

  it("formats the time label the same everywhere, without locale-dependent spacing", () => {
    expect(formatFeedTime("2026-11-30T12:05:00.000Z")).toBe("Nov 30, 2026, 6:05 AM CT");
    expect(formatFeedTime("2026-07-04T01:00:00.000Z")).toBe("Jul 3, 2026, 8:00 PM CT");
  });

  it("says so when the feed is empty, and shows no mark-all button", () => {
    const markup = renderToStaticMarkup(createElement(AdminAttentionBell, { defaultOpen: true, initial: summary, initialFeed: { unreadCount: 0, items: [] } }));
    expect(markup).toContain("No alerts in the last 90 days.");
    expect(markup).not.toContain("Mark all read");
  });
});
