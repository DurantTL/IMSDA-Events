import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isAuthorizedSweepRequest: vi.fn(),
  sweepOutbox: vi.fn(),
  recordSweepHeartbeat: vi.fn(),
  recordJobRun: vi.fn(),
  runAlertScan: vi.fn(),
  pruneExpiredCommunityContent: vi.fn(),
  sendDueLocationWaitlistDigests: vi.fn(),
  logError: vi.fn(),
  refreshDueCalendarFeeds: vi.fn(),
  sweepHostedCheckouts: vi.fn(),
  runHealthSnapshotSweep: vi.fn(),
  expireStalePendingTeams: vi.fn(),
  prunePublicMetrics: vi.fn(),
  sweepMessageFiles: vi.fn(),
  messageFileSweepDeletes: vi.fn(),
  pruneAlertFeed: vi.fn(),
  reconcileDeadlineReminders: vi.fn(),
  sweepClassWaitlists: vi.fn(),
  sendDueClassChangeEmails: vi.fn(),
  sendDueHonorWatchSummaries: vi.fn(),
  healthRecordsEnabled: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", async () => {
  const actual = await vi.importActual<typeof import("@/lib/logger")>("@/lib/logger");
  return { ...actual, logError: mocks.logError };
});
vi.mock("@/modules/communications/outbox-sweep", () => ({
  isAuthorizedSweepRequest: mocks.isAuthorizedSweepRequest,
  sweepOutbox: mocks.sweepOutbox,
}));
vi.mock("@/modules/community/repository", () => ({ pruneExpiredCommunityContent: mocks.pruneExpiredCommunityContent }));
vi.mock("@/modules/operations/alert-scan", () => ({ runAlertScan: mocks.runAlertScan }));
vi.mock("@/modules/operations/sweep-heartbeat-repository", () => ({ recordSweepHeartbeat: mocks.recordSweepHeartbeat, recordJobRun: mocks.recordJobRun }));
vi.mock("@/modules/payments/square-hosted-invalidation", () => ({ sweepHostedCheckouts: mocks.sweepHostedCheckouts }));
vi.mock("@/modules/health-records/snapshot-hooks", () => ({ runHealthSnapshotSweep: mocks.runHealthSnapshotSweep, sealedCopiesEnabled: mocks.healthRecordsEnabled }));
vi.mock("@/modules/general-link-registrations/repository", () => ({ expireStalePendingTeams: mocks.expireStalePendingTeams }));
vi.mock("@/modules/public-metrics/repository", () => ({ prunePublicMetrics: mocks.prunePublicMetrics }));
vi.mock("@/modules/calendar/feeds", () => ({ refreshDueCalendarFeeds: mocks.refreshDueCalendarFeeds }));
vi.mock("@/modules/event-locations/waitlist-digest", () => ({ sendDueLocationWaitlistDigests: mocks.sendDueLocationWaitlistDigests }));
vi.mock("@/modules/notifications/feed", () => ({ pruneAlertFeed: mocks.pruneAlertFeed }));
vi.mock("@/modules/calendar/deadline-reminders", () => ({ reconcileDeadlineReminders: mocks.reconcileDeadlineReminders }));
vi.mock("@/modules/honors/waitlist-repository", () => ({ sweepClassWaitlists: mocks.sweepClassWaitlists }));
vi.mock("@/modules/honors/class-change-emails", () => ({ sendDueClassChangeEmails: mocks.sendDueClassChangeEmails }));
vi.mock("@/modules/honors/watch-emails", () => ({ sendDueHonorWatchSummaries: mocks.sendDueHonorWatchSummaries }));

vi.mock("@/modules/communications/message-file-sweep", () => ({ sweepMessageFiles: mocks.sweepMessageFiles }));
vi.mock("@/modules/communications/message-file-config", () => ({ messageFileSweepDeletes: mocks.messageFileSweepDeletes }));

import { POST } from "@/app/api/internal/outbox/sweep/route";

/**
 * The scheduled outbox sweep also sends the daily location waitlist digest
 * (#599), reusing the one cron and credential this repository already runs.
 */
const request = () => new Request("https://events.imsda.test/api/internal/outbox/sweep", { method: "POST", headers: { authorization: "Bearer synthetic" } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAuthorizedSweepRequest.mockReturnValue(true);
  mocks.sweepOutbox.mockResolvedValue({ sweptEventIds: [], skipped: [], sweptAccountMessages: false, snapshotBefore: { pending: 0 } });
  mocks.recordSweepHeartbeat.mockResolvedValue(undefined);
  mocks.recordJobRun.mockResolvedValue(undefined);
  mocks.runAlertScan.mockResolvedValue({ sent: [], suppressed: [], undelivered: [], cleared: 0 });
  mocks.pruneExpiredCommunityContent.mockResolvedValue({ removedPosts: 0 });
  mocks.pruneAlertFeed.mockResolvedValue(0);
  mocks.reconcileDeadlineReminders.mockResolvedValue({ prepared: 0, updated: 0, withdrawn: 0 });
  mocks.sweepClassWaitlists.mockResolvedValue({ classes: 0, offered: 0, lapsed: 0, failed: 0, budgetExhausted: false });
  mocks.sendDueClassChangeEmails.mockResolvedValue({ status: "RAN", immediate: { changes: 0, queued: 0, skippedStale: 0, failed: 0 }, summaries: { due: false, instructors: 0, queued: 0, noChanges: 0, failed: 0 }, delivered: 0, pruned: 0 });
  mocks.sendDueHonorWatchSummaries.mockResolvedValue({ status: "RAN", due: false, watches: 0, queued: 0, noChanges: 0, failed: 0, messages: 0, delivered: 0 });
  mocks.healthRecordsEnabled.mockReturnValue(false);
  mocks.refreshDueCalendarFeeds.mockResolvedValue({ due: 0, refreshed: 0, failed: 0 });
  mocks.sweepHostedCheckouts.mockResolvedValue({ withdrawn: 0, deleted: 0, failed: 0 });
  mocks.runHealthSnapshotSweep.mockResolvedValue(null);
  mocks.expireStalePendingTeams.mockResolvedValue({ expired: 0, events: 0 });
  mocks.prunePublicMetrics.mockResolvedValue(0);
  mocks.messageFileSweepDeletes.mockReturnValue(false);
  mocks.sweepMessageFiles.mockImplementation(async (options: { mode: string }) => ({
    mode: options.mode, graceHours: 72, candidates: { count: 2, bytes: 300, byEvent: [{ eventId: "event-1", count: 2, bytes: 300 }] },
    deleted: { count: 0, bytes: 0 }, keptAtRecheck: 0, bytesRemoved: { count: 0, bytes: 0 }, cleanup: { pending: 0, retried: 0, succeeded: 0, failed: 0 },
    reservations: { expired: 0, reconciled: 0 }, wouldDelete: [{ id: "f1", eventId: "event-1", filename: "x.pdf", sizeBytes: 1, createdAt: "2026-01-01T00:00:00.000Z" }],
  }));
  mocks.sendDueLocationWaitlistDigests.mockResolvedValue({ status: "QUEUED", dateKey: "2026-10-06", changesCovered: 4, recipients: 2, messageIds: ["m1", "m2"], delivered: 2 });
});

describe("the sweep and sealed health copies (#924)", () => {
  it("runs the sealed health copy sweep and reports its counts, and a failure there does not fail the sweep", async () => {
    mocks.runHealthSnapshotSweep.mockResolvedValueOnce({ started: { taken: 1 }, retention: { deleted: 2 } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).healthSnapshots).toEqual({ started: { taken: 1 }, retention: { deleted: 2 } });

    mocks.runHealthSnapshotSweep.mockRejectedValueOnce(new Error("synthetic failure"));
    const failed = await POST(request());
    expect(failed.status).toBe(200);
    expect((await failed.json()).healthSnapshots).toBeNull();
  });
});

describe("the sweep and the message file sweep (#845)", () => {
  it("is a dry run unless MESSAGE_FILE_SWEEP_DELETE is true, and reports counts only", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.sweepMessageFiles).toHaveBeenCalledWith({ mode: "dry-run" });
    const body = await response.json();
    expect(body.messageFiles).toMatchObject({ mode: "dry-run", candidates: 2, candidateBytes: 300, deleted: 0 });
    expect(JSON.stringify(body.messageFiles)).not.toContain("x.pdf");
  });

  it("applies only when the setting says so", async () => {
    mocks.messageFileSweepDeletes.mockReturnValue(true);
    await POST(request());
    expect(mocks.sweepMessageFiles).toHaveBeenCalledWith({ mode: "apply" });
  });

  it("stays a successful sweep when the message file sweep fails", async () => {
    mocks.sweepMessageFiles.mockRejectedValueOnce(new Error("synthetic message file fault"));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).messageFiles).toBeNull();
    expect(mocks.logError).toHaveBeenCalledWith(expect.stringContaining("message file sweep failed"), expect.any(Error));
    expect(mocks.recordSweepHeartbeat).toHaveBeenCalledWith("SUCCEEDED");
  });
});

describe("the sweep and the daily waitlist digest", () => {
  it("runs the digest on each sweep and reports what it did, without the message ids", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.sendDueLocationWaitlistDigests).toHaveBeenCalledTimes(1);
    const body = await response.json();
    expect(body.locationWaitlistDigest).toEqual({ status: "QUEUED", changesCovered: 4, recipients: 2, delivered: 2 });
  });

  it("runs nothing, digest included, for an unauthorized caller", async () => {
    mocks.isAuthorizedSweepRequest.mockReturnValue(false);
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.sweepOutbox).not.toHaveBeenCalled();
    expect(mocks.sendDueLocationWaitlistDigests).not.toHaveBeenCalled();
  });

  it("stays a successful sweep when the digest fails: the failure is logged, never returned", async () => {
    mocks.sendDueLocationWaitlistDigests.mockRejectedValue(new Error("synthetic digest fault"));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).locationWaitlistDigest).toBeNull();
    expect(mocks.logError).toHaveBeenCalledWith(expect.stringContaining("location waitlist digest failed"), expect.any(Error));
    expect(mocks.recordSweepHeartbeat).toHaveBeenCalledWith("SUCCEEDED");
  });

  it("refreshes due calendar feeds after the outbox work, and a feed fault never fails the sweep", async () => {
    mocks.refreshDueCalendarFeeds.mockResolvedValueOnce({ due: 2, refreshed: 1, failed: 1 });
    const ok = await POST(request());
    expect((await ok.json()).calendarFeeds).toEqual({ due: 2, refreshed: 1, failed: 1 });

    mocks.refreshDueCalendarFeeds.mockRejectedValueOnce(new Error("synthetic feed fault"));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).calendarFeeds).toBeNull();
    expect(mocks.logError).toHaveBeenCalledWith(expect.stringContaining("calendar feed refresh failed"), expect.any(Error));
  });

  it("sweeps Pay on Square links (#327), and a fault there never fails the sweep", async () => {
    mocks.sweepHostedCheckouts.mockResolvedValueOnce({ withdrawn: 2, deleted: 1, failed: 1 });
    const ok = await POST(request());
    expect((await ok.json()).hostedLinks).toEqual({ withdrawn: 2, deleted: 1, failed: 1 });

    mocks.sweepHostedCheckouts.mockRejectedValueOnce(new Error("synthetic link fault"));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).hostedLinks).toBeNull();
    expect(mocks.logError).toHaveBeenCalledWith(expect.stringContaining("Pay on Square link sweep failed"), expect.any(Error));
    expect(mocks.recordSweepHeartbeat).toHaveBeenCalledWith("SUCCEEDED");
  });

  it("does not send the digest when the sweep itself fails", async () => {
    mocks.sweepOutbox.mockRejectedValue(new Error("synthetic sweep fault"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(mocks.sendDueLocationWaitlistDigests).not.toHaveBeenCalled();
  });
});

describe("the sweep and the general link's retention (#931)", () => {
  it("expires stale waiting teams and reports counts only, and a failure there does not fail the sweep", async () => {
    mocks.expireStalePendingTeams.mockResolvedValueOnce({ expired: 3, events: 1 });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).generalLinkRetention).toEqual({ expired: 3, events: 1 });

    mocks.expireStalePendingTeams.mockRejectedValueOnce(new Error("synthetic failure"));
    const failed = await POST(request());
    expect(failed.status).toBe(200);
    expect((await failed.json()).generalLinkRetention).toBeNull();
    expect(mocks.logError).toHaveBeenCalledWith("The general link retention sweep failed after a successful outbox sweep", expect.any(Error));
  });
});

describe("the sweep and public analytics retention (#111)", () => {
  it("prunes old daily counts on each sweep and reports how many went", async () => {
    mocks.prunePublicMetrics.mockResolvedValueOnce(12);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.prunePublicMetrics).toHaveBeenCalledTimes(1);
    expect((await response.json()).publicMetricsRetention).toBe(12);
  });

  it("is not failed by a pruning error", async () => {
    mocks.prunePublicMetrics.mockRejectedValueOnce(new Error("synthetic failure"));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).publicMetricsRetention).toBeNull();
  });
});

describe("the sweep records its steps for the System report (#1357)", () => {
  it("stores calendar and message file counts only, with no file name or path", async () => {
    mocks.refreshDueCalendarFeeds.mockResolvedValueOnce({ due: 2, refreshed: 1, failed: 1 });
    await POST(request());
    expect(mocks.recordJobRun).toHaveBeenCalledWith("calendar-feed-refresh", "SUCCEEDED", { due: 2, refreshed: 1, failed: 1 });
    expect(mocks.recordJobRun).toHaveBeenCalledWith("message-file-cleanup", "SUCCEEDED", { mode: "dry-run", candidates: 2, deleted: 0, cleanupPending: 0, cleanupFailed: 0 });
    expect(JSON.stringify(mocks.recordJobRun.mock.calls)).not.toContain("x.pdf");
  });

  it("records a step that failed as FAILED", async () => {
    mocks.refreshDueCalendarFeeds.mockRejectedValueOnce(new Error("synthetic"));
    mocks.sweepMessageFiles.mockRejectedValueOnce(new Error("synthetic"));
    await POST(request());
    expect(mocks.recordJobRun).toHaveBeenCalledWith("calendar-feed-refresh", "FAILED", undefined);
    expect(mocks.recordJobRun).toHaveBeenCalledWith("message-file-cleanup", "FAILED", undefined);
  });

  it("stays a successful sweep when recording a step fails", async () => {
    mocks.recordJobRun.mockRejectedValue(new Error("synthetic database fault"));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.logError).toHaveBeenCalledWith(expect.stringContaining("Could not record the calendar feed refresh run"), expect.any(Error));
    expect(mocks.recordSweepHeartbeat).toHaveBeenCalledWith("SUCCEEDED");
  });
});

describe("the sweep records every remaining step for the System report (#1377)", () => {
  const recorded = () => mocks.recordJobRun.mock.calls;

  it("stores counts and fixed words for each step, and nothing that names anyone", async () => {
    mocks.runAlertScan.mockResolvedValueOnce({
      sent: [{ key: "system.secret-key-name" }], suppressed: [{ key: "a" }, { key: "b" }], undelivered: [], cleared: 3,
    });
    mocks.reconcileDeadlineReminders.mockResolvedValueOnce({ prepared: 2, updated: 1, withdrawn: 0 });
    mocks.sweepClassWaitlists.mockResolvedValueOnce({ classes: 5, offered: 2, lapsed: 1, failed: 0, budgetExhausted: true });
    mocks.sendDueClassChangeEmails.mockResolvedValueOnce({
      status: "RAN", immediate: { changes: 3, queued: 2, skippedStale: 0, failed: 1 }, summaries: { due: true, instructors: 2, queued: 2, noChanges: 0, failed: 0 }, delivered: 3, pruned: 7,
    });
    mocks.sendDueHonorWatchSummaries.mockResolvedValueOnce({ status: "RAN", due: true, watches: 4, queued: 3, noChanges: 1, failed: 0, messages: 3, delivered: 3 });
    mocks.healthRecordsEnabled.mockReturnValue(true);
    mocks.runHealthSnapshotSweep.mockResolvedValueOnce({
      started: { events: 2, taken: 6, skipped: 1, failed: 1 }, retention: { ran: true, deleted: 4, heldSkipped: 2, batches: 1, backlogRemaining: false },
    });
    mocks.pruneExpiredCommunityContent.mockResolvedValueOnce({ removedPosts: 5 });
    mocks.pruneAlertFeed.mockResolvedValueOnce(6);
    mocks.prunePublicMetrics.mockResolvedValueOnce(7);

    const response = await POST(request());
    expect(response.status).toBe(200);

    expect(recorded()).toContainEqual(["alert-scan", "SUCCEEDED", { sent: 1, suppressed: 2, undelivered: 0, cleared: 3 }]);
    expect(recorded()).toContainEqual(["deadline-reminder-preparation", "SUCCEEDED", { prepared: 2, updated: 1, withdrawn: 0 }]);
    expect(recorded()).toContainEqual(["location-waitlist-digest", "SUCCEEDED", { status: "QUEUED", changesCovered: 4, recipients: 2, delivered: 2 }]);
    expect(recorded()).toContainEqual(["class-waitlist-sweep", "SUCCEEDED", { classes: 5, offered: 2, lapsed: 1, failed: 0, budgetExhausted: true }]);
    expect(recorded()).toContainEqual(["instructor-class-emails", "SUCCEEDED", { status: "RAN", queued: 4, failed: 1, delivered: 3 }]);
    expect(recorded()).toContainEqual(["honor-watch-summaries", "SUCCEEDED", { status: "RAN", watches: 4, queued: 3, failed: 0, delivered: 3 }]);
    expect(recorded()).toContainEqual(["health-snapshot-sweep", "SUCCEEDED", { enabled: true, taken: 6, sealFailed: 1, deleted: 4, heldSkipped: 2 }]);
    expect(recorded()).toContainEqual(["retention-cleanup", "SUCCEEDED", { community: 5, alertFeed: 6, analytics: 7 }]);
    expect(JSON.stringify(recorded())).not.toContain("secret-key-name");
  });

  it("records every step that threw as FAILED, and a failed run sends no summary, so the last good one is kept", async () => {
    mocks.runAlertScan.mockRejectedValueOnce(new Error("synthetic"));
    mocks.reconcileDeadlineReminders.mockRejectedValueOnce(new Error("synthetic"));
    mocks.sendDueLocationWaitlistDigests.mockRejectedValueOnce(new Error("synthetic"));
    mocks.sweepClassWaitlists.mockRejectedValueOnce(new Error("synthetic"));
    mocks.sendDueClassChangeEmails.mockRejectedValueOnce(new Error("synthetic"));
    mocks.sendDueHonorWatchSummaries.mockRejectedValueOnce(new Error("synthetic"));
    mocks.runHealthSnapshotSweep.mockRejectedValueOnce(new Error("synthetic"));
    mocks.pruneAlertFeed.mockRejectedValueOnce(new Error("synthetic"));
    mocks.pruneExpiredCommunityContent.mockResolvedValueOnce({ removedPosts: 5 });
    mocks.prunePublicMetrics.mockResolvedValueOnce(7);

    const response = await POST(request());
    expect(response.status).toBe(200);
    for (const job of ["alert-scan", "deadline-reminder-preparation", "location-waitlist-digest", "class-waitlist-sweep", "instructor-class-emails", "honor-watch-summaries"]) {
      expect(recorded()).toContainEqual([job, "FAILED", undefined]);
    }
    expect(recorded()).toContainEqual(["health-snapshot-sweep", "FAILED", undefined]);
    expect(recorded()).toContainEqual(["retention-cleanup", "FAILED", undefined]);
  });

  it("records the health sweep as a success with health records off, where no seal result is expected", async () => {
    mocks.runHealthSnapshotSweep.mockResolvedValueOnce({ started: null, retention: { ran: true, deleted: 0, heldSkipped: 0, batches: 0, backlogRemaining: false } });
    await POST(request());
    expect(recorded()).toContainEqual(["health-snapshot-sweep", "SUCCEEDED", { enabled: false, taken: null, sealFailed: null, deleted: 0, heldSkipped: 0 }]);
  });

  it("records the health sweep as failed when an inner step failed (health records on, no seal result)", async () => {
    mocks.healthRecordsEnabled.mockReturnValue(true);
    mocks.runHealthSnapshotSweep.mockResolvedValueOnce({ started: null, retention: { ran: true, deleted: 0, heldSkipped: 0, batches: 0, backlogRemaining: false } });
    await POST(request());
    expect(recorded().find((call) => call[0] === "health-snapshot-sweep")?.[1]).toBe("FAILED");
  });

  it("leaves the response unchanged when recording throws, whether it rejects or throws at once", async () => {
    const baseline = await (await POST(request())).json();

    mocks.recordJobRun.mockRejectedValue(new Error("synthetic database fault"));
    const rejected = await POST(request());
    expect(rejected.status).toBe(200);
    expect(await rejected.json()).toEqual(baseline);

    mocks.recordJobRun.mockImplementation(() => { throw new Error("synthetic immediate fault"); });
    const thrown = await POST(request());
    expect(thrown.status).toBe(200);
    expect(await thrown.json()).toEqual(baseline);
    expect(mocks.logError).toHaveBeenCalledWith(expect.stringContaining("Could not record the alert scan run"), expect.any(Error));
    expect(mocks.recordSweepHeartbeat).toHaveBeenCalledWith("SUCCEEDED");
  });
});
