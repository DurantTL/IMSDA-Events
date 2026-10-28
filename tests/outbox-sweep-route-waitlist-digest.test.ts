import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isAuthorizedSweepRequest: vi.fn(),
  sweepOutbox: vi.fn(),
  recordSweepHeartbeat: vi.fn(),
  runAlertScan: vi.fn(),
  pruneExpiredCommunityContent: vi.fn(),
  sendDueLocationWaitlistDigests: vi.fn(),
  logError: vi.fn(),
  refreshDueCalendarFeeds: vi.fn(),
  sweepHostedCheckouts: vi.fn(),
  runHealthSnapshotSweep: vi.fn(),
  expireStalePendingTeams: vi.fn(),
  prunePublicMetrics: vi.fn(),
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
vi.mock("@/modules/operations/sweep-heartbeat-repository", () => ({ recordSweepHeartbeat: mocks.recordSweepHeartbeat }));
vi.mock("@/modules/payments/square-hosted-invalidation", () => ({ sweepHostedCheckouts: mocks.sweepHostedCheckouts }));
vi.mock("@/modules/health-records/snapshot-hooks", () => ({ runHealthSnapshotSweep: mocks.runHealthSnapshotSweep }));
vi.mock("@/modules/general-link-registrations/repository", () => ({ expireStalePendingTeams: mocks.expireStalePendingTeams }));
vi.mock("@/modules/public-metrics/repository", () => ({ prunePublicMetrics: mocks.prunePublicMetrics }));
vi.mock("@/modules/calendar/feeds", () => ({ refreshDueCalendarFeeds: mocks.refreshDueCalendarFeeds }));
vi.mock("@/modules/event-locations/waitlist-digest", () => ({ sendDueLocationWaitlistDigests: mocks.sendDueLocationWaitlistDigests }));

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
  mocks.runAlertScan.mockResolvedValue({ sent: [], suppressed: [], undelivered: [], cleared: [] });
  mocks.pruneExpiredCommunityContent.mockResolvedValue({ removed: 0 });
  mocks.refreshDueCalendarFeeds.mockResolvedValue({ due: 0, refreshed: 0, failed: 0 });
  mocks.sweepHostedCheckouts.mockResolvedValue({ withdrawn: 0, deleted: 0, failed: 0 });
  mocks.runHealthSnapshotSweep.mockResolvedValue(null);
  mocks.expireStalePendingTeams.mockResolvedValue({ expired: 0, events: 0 });
  mocks.prunePublicMetrics.mockResolvedValue(0);
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
