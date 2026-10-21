import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  isNotificationEnabled: vi.fn(),
  loadEventEmailSettings: vi.fn(),
  processQueuedMessageIdsAfterCommit: vi.fn(),
  logError: vi.fn(),
  order: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.imsda-events.test" }) }));
vi.mock("@/lib/logger", async () => {
  const actual = await vi.importActual<typeof import("@/lib/logger")>("@/lib/logger");
  return { ...actual, logError: mocks.logError };
});
vi.mock("@/modules/notifications/settings", () => ({ isNotificationEnabled: mocks.isNotificationEnabled }));
vi.mock("@/modules/communications/effective-delivery", () => ({ loadEventEmailSettings: mocks.loadEventEmailSettings }));
vi.mock("@/modules/communications/messaging-repository", () => ({ processQueuedMessageIdsAfterCommit: mocks.processQueuedMessageIdsAfterCommit }));

import { sendDueHonorWatchSummaries } from "@/modules/honors/watch-emails";

/**
 * The honor watch sender (#1099) against a small stand-in for the handful of Prisma calls it makes. The real database run is
 * `npm run test:honor-watch`; this proves the order of things (switch first, delivery after commit) and the matching, netting
 * and suppression rules without a database. Synthetic data only.
 */

const DAY = 24 * 60 * 60 * 1000;
// 2026-11-03 12:00 UTC is 6:00 AM Central (CST): the summary's cutoff. Run well after it.
const sendAt = new Date("2026-11-03T12:00:00Z");
const now = new Date(sendAt.getTime() + 10 * 60 * 1000);

type Msg = { idempotencyKey: string; status: string; recipientEmail: string; subjectSnapshot: string; bodyTextSnapshot: string; metadata: Record<string, unknown>; lastError: string | null };

function world(options: { watch?: Partial<{ honorIds: string[]; offeringIds: string[]; recipients: string[]; summaryAt: Date | null }>; paused?: boolean; changes?: Array<Record<string, unknown>> } = {}) {
  const watch = {
    id: "watch-1", eventId: "event-1", name: "Nature", recipients: ["a@example.test", "b@example.test"], honorIds: ["birds"], offeringIds: [] as string[],
    summaryAt: null as Date | null, createdAt: new Date(sendAt.getTime() - 3 * DAY), ...options.watch,
  };
  const outbox = new Map<string, Msg>();
  const changes = options.changes ?? [];
  const offerings = [
    { id: "class-multi", span: "SINGLE_SESSION", session: { name: "Sabbath afternoon" }, honors: [{ honor: { id: "knots", code: "K", name: "Knots", isActive: true } }, { honor: { id: "birds", code: "B", name: "Birds", isActive: true } }] },
    { id: "class-other", span: "ALL_SESSIONS", session: null, honors: [{ honor: { id: "stars", code: "S", name: "Stars", isActive: true } }] },
  ];
  const tx = {
    honorWatch: {
      findUnique: vi.fn(async () => ({ ...watch })),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; summaryAt: Date | null }; data: { summaryAt: Date } }) => {
        const same = (where.summaryAt?.getTime() ?? null) === (watch.summaryAt?.getTime() ?? null);
        if (where.id !== watch.id || !same) return { count: 0 };
        watch.summaryAt = data.summaryAt;
        return { count: 1 };
      }),
    },
    honorClassChange: {
      findMany: vi.fn(async ({ where }: { where: { at: { gt: Date; lte: Date } } }) => changes.filter((row) => (row.at as Date) > where.at.gt && (row.at as Date) <= where.at.lte)),
    },
    honorOffering: { findMany: vi.fn(async () => offerings) },
    messageOutbox: {
      upsert: vi.fn(async ({ where, create }: { where: { idempotencyKey: string }; create: Msg }) => {
        const existing = outbox.get(where.idempotencyKey);
        if (existing) return { id: where.idempotencyKey, status: existing.status };
        outbox.set(where.idempotencyKey, create);
        return { id: where.idempotencyKey, status: create.status };
      }),
    },
  };
  mocks.getPrisma.mockReturnValue({
    honorWatch: {
      findMany: vi.fn(async ({ where }: { where: { id?: { gt: string } } }) => (where.id?.gt ? [] : [{ id: watch.id, eventId: watch.eventId, event: { name: "Synthetic Honors Weekend", endsAt: new Date(now.getTime() + 5 * DAY) } }])),
    },
    $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => {
      mocks.order.push("transaction:start");
      const value = await work(tx);
      mocks.order.push("transaction:commit");
      return value;
    }),
  });
  mocks.loadEventEmailSettings.mockResolvedValue({
    senderName: "IMSDA Events", senderEmail: "events@imsda-events.test", replyToEmail: null, deliveryMode: "EXTERNAL_EMAIL",
    ...(options.paused ? { deliveryReason: "PAUSED" } : {}),
  });
  return { watch, outbox, tx };
}

const change = (id: string, kind: "JOINED" | "LEFT", minutesBefore: number, extra: Record<string, unknown> = {}) => ({
  id, eventId: "event-1", offeringId: "class-multi", registrationAttendeeId: "kid-1", kind, youthName: "Pat Example", clubName: "Synthetic Club", ageOnEventDate: 12,
  at: new Date(sendAt.getTime() - minutesBefore * 60 * 1000), ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  mocks.isNotificationEnabled.mockResolvedValue(true);
  mocks.processQueuedMessageIdsAfterCommit.mockImplementation(async (ids: string[]) => {
    mocks.order.push("deliver");
    return { sentIds: ids, capturedIds: [] };
  });
});

describe("honor watch summaries (#1099)", () => {
  it("reads the staff switch first and does nothing, not even a database read, when it is off", async () => {
    mocks.isNotificationEnabled.mockResolvedValue(false);
    const result = await sendDueHonorWatchSummaries(now);
    expect(mocks.isNotificationEnabled).toHaveBeenCalledWith("HONOR_WATCH_SUMMARIES");
    expect(result.status).toBe("SWITCHED_OFF");
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("sends nothing before 6:00 AM Central", async () => {
    const w = world({ changes: [change("a", "JOINED", 30)] });
    const result = await sendDueHonorWatchSummaries(new Date(sendAt.getTime() - 20 * 60 * 1000));
    expect(result.due).toBe(false);
    expect(w.outbox.size).toBe(0);
  });

  it("queues one message per address for a class that teaches a watched honor among several, then delivers after the commit", async () => {
    const w = world({ changes: [change("a", "JOINED", 30)] });
    const result = await sendDueHonorWatchSummaries(now);
    expect(result).toMatchObject({ queued: 1, messages: 2, noChanges: 0, delivered: 2 });
    expect([...w.outbox.keys()].sort()).toEqual([
      "honor-watch-summary:watch-1:2026-11-03:a@example.test",
      "honor-watch-summary:watch-1:2026-11-03:b@example.test",
    ]);
    const message = [...w.outbox.values()][0]!;
    expect(message.bodyTextSnapshot).toContain("Joined: Pat Example (Synthetic Club, age 12)");
    expect(message.bodyTextSnapshot).toContain("Knots + Birds (Sabbath afternoon)");
    expect(JSON.stringify(message.metadata)).not.toContain("Pat");
    expect(w.watch.summaryAt).toEqual(sendAt);
    expect(mocks.order).toEqual(["transaction:start", "transaction:commit", "deliver"]);
  });

  it("matches a watch on a specific class, and ignores a class it does not look at", async () => {
    const other = change("o", "JOINED", 20, { offeringId: "class-other", registrationAttendeeId: "kid-2", youthName: "Sam Example" });
    const byHonor = world({ changes: [other] });
    expect((await sendDueHonorWatchSummaries(now)).noChanges).toBe(1);
    expect(byHonor.outbox.size).toBe(0);
    const byClass = world({ watch: { honorIds: [], offeringIds: ["class-other"] }, changes: [other] });
    expect((await sendDueHonorWatchSummaries(now)).queued).toBe(1);
    expect([...byClass.outbox.values()][0]!.bodyTextSnapshot).toContain("Joined: Sam Example");
  });

  it("nets out a join followed by a leave, sends nothing, and still moves the summary point", async () => {
    const w = world({ changes: [change("a", "JOINED", 60), change("b", "LEFT", 30)] });
    const result = await sendDueHonorWatchSummaries(now);
    expect(result).toMatchObject({ queued: 0, noChanges: 1 });
    expect(w.outbox.size).toBe(0);
    expect(w.watch.summaryAt).toEqual(sendAt);
    expect(mocks.processQueuedMessageIdsAfterCommit).not.toHaveBeenCalled();
  });

  it("reports only what happened after the last summary point and before the cutoff", async () => {
    const w = world({
      watch: { summaryAt: new Date(sendAt.getTime() - DAY) },
      changes: [change("old", "JOINED", 24 * 60 + 5, { youthName: "Old Example" }), change("in", "JOINED", 30, { registrationAttendeeId: "kid-3", youthName: "New Example" }), change("late", "JOINED", -5, { registrationAttendeeId: "kid-4", youthName: "Late Example" })],
    });
    await sendDueHonorWatchSummaries(now);
    const text = [...w.outbox.values()][0]!.bodyTextSnapshot;
    expect(text).toContain("New Example");
    expect(text).not.toContain("Old Example");
    expect(text).not.toContain("Late Example");
  });

  it("sends once however many sweeps run: the second finds the summary point already moved", async () => {
    const w = world({ changes: [change("a", "JOINED", 30)] });
    await sendDueHonorWatchSummaries(now);
    await sendDueHonorWatchSummaries(new Date(now.getTime() + 60 * 60 * 1000));
    expect(w.outbox.size).toBe(2);
    expect(mocks.processQueuedMessageIdsAfterCommit).toHaveBeenCalledTimes(1);
  });

  it("records a paused event's messages as suppressed and delivers none", async () => {
    const w = world({ paused: true, changes: [change("a", "JOINED", 30)] });
    const result = await sendDueHonorWatchSummaries(now);
    expect(result.queued).toBe(1);
    expect([...w.outbox.values()].every((message) => message.status === "SUPPRESSED" && message.lastError)).toBe(true);
    expect(mocks.processQueuedMessageIdsAfterCommit).not.toHaveBeenCalled();
  });

  it("never carries a birth date", async () => {
    const w = world({ changes: [change("a", "JOINED", 30, { birthDate: "2013-02-03" })] });
    await sendDueHonorWatchSummaries(now);
    for (const message of w.outbox.values()) expect(`${message.subjectSnapshot}${message.bodyTextSnapshot}`).not.toMatch(/2013|birth/i);
  });
});
