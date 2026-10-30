import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  runConnectionTests: vi.fn(),
  getEmailAvailability: vi.fn(),
  getActiveEmailProviderName: vi.fn(),
  getResendEmailConfiguration: vi.fn(),
  getSesEmailConfiguration: vi.fn(),
  verifySesConnection: vi.fn(),
  getSquareConfiguration: vi.fn(),
  upsert: vi.fn(),
  getPrisma: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", async () => {
  const actual = await vi.importActual<typeof import("@/lib/logger")>("@/lib/logger");
  return { ...actual, logError: mocks.logError };
});
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/system-admin/system-report/connection-tests", () => ({ runConnectionTests: mocks.runConnectionTests }));
vi.mock("@/integrations/email/provider", () => ({
  getEmailAvailability: mocks.getEmailAvailability,
  getActiveEmailProviderName: mocks.getActiveEmailProviderName,
}));
vi.mock("@/integrations/email/resend", () => ({ getResendEmailConfiguration: mocks.getResendEmailConfiguration }));
vi.mock("@/integrations/email/ses", () => ({
  getSesEmailConfiguration: mocks.getSesEmailConfiguration,
  verifySesConnection: mocks.verifySesConnection,
}));
vi.mock("@/modules/payments/square-config", () => ({ getSquareConfiguration: mocks.getSquareConfiguration }));
vi.mock("@/modules/events/asset-storage", () => ({ storageRoot: () => "/synthetic/uploads" }));

import { POST } from "@/app/api/admin/system-report/test-connections/route";
import { checkEmailReachable } from "@/integrations/email/reachability";
import { checkSquareReachable } from "@/modules/payments/square-reachability";
import { readDiskSpace } from "@/modules/operations/disk-space";
import { recordJobRun, getJobRun } from "@/modules/operations/sweep-heartbeat-repository";
import { calendarRefreshFields, diskFields, messageFileCleanupFields, reachabilityFields } from "@/modules/system-admin/system-report/job-signals";
import type { JobRun } from "@/modules/operations/sweep-heartbeat-repository";

/** #1357 round 2: the new signals. Synthetic data only. */

const now = new Date("2026-10-30T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

function run(overrides: Partial<JobRun>): JobRun {
  return { status: "ok", lastSucceededAt: minutesAgo(5), lastFailedAt: null, ageMs: 300_000, summary: null, ...overrides };
}

describe("calendar feed refresh and message file cleanup", () => {
  it("reads never reported as unavailable, never OK", () => {
    for (const fields of [calendarRefreshFields, messageFileCleanupFields]) {
      const row = fields("k", run({ status: "never", lastSucceededAt: null, ageMs: null }), now);
      expect(row.state).toBe("unavailable");
      expect(row.resultText).toContain("Never reported");
    }
  });

  it("reads a latest failure as attention and no success in an hour as watch", () => {
    expect(calendarRefreshFields("k", run({ status: "failing", lastFailedAt: minutesAgo(1) }), now).state).toBe("attention");
    expect(messageFileCleanupFields("k", run({ status: "stale", lastSucceededAt: minutesAgo(120) }), now).state).toBe("watch");
  });

  it("reads calendar counts: OK with none failed, watch with some failed", () => {
    expect(calendarRefreshFields("k", run({ summary: { due: 3, refreshed: 3, failed: 0 } }), now)).toMatchObject({ state: "ok", resultText: "3 due, 3 refreshed, 0 failed." });
    expect(calendarRefreshFields("k", run({ summary: { due: 3, refreshed: 2, failed: 1 } }), now).state).toBe("watch");
    // A success with no counts recorded is not shown as OK.
    expect(calendarRefreshFields("k", run({ summary: null }), now).state).toBe("watch");
  });

  it("reads message file counts and keeps names and paths out", () => {
    const row = messageFileCleanupFields("k", run({ summary: { mode: "dry-run", candidates: 4, deleted: 0, cleanupPending: 2, cleanupFailed: 0 } }), now);
    expect(row).toMatchObject({ state: "ok" });
    expect(row.resultText).toBe("Report only: 4 unused, 0 deleted, 2 waiting to be removed, 0 removals failed.");
    expect(messageFileCleanupFields("k", run({ summary: { mode: "apply", candidates: 4, deleted: 4, cleanupPending: 0, cleanupFailed: 1 } }), now).state).toBe("watch");
  });
});

describe("server disk space", () => {
  const gb = 1024 ** 3;
  const disk = (percentFree: number) => ({ percentFree, freeBytes: (percentFree / 100) * 100 * gb, totalBytes: 100 * gb });

  it("is attention under 10% free, watch under 20% and OK otherwise", () => {
    expect(diskFields("d", disk(9.9), now).state).toBe("attention");
    expect(diskFields("d", disk(10), now).state).toBe("watch");
    expect(diskFields("d", disk(19.9), now).state).toBe("watch");
    expect(diskFields("d", disk(20), now).state).toBe("ok");
    expect(diskFields("d", disk(35), now).resultText).toBe("35% free (35 GB).");
  });

  it("reads free space from statfs and never returns a path", async () => {
    const statfs = vi.fn().mockResolvedValue({ bavail: BigInt(25), blocks: BigInt(100), bsize: BigInt(4096) });
    const result = await readDiskSpace(statfs, "/synthetic/uploads");
    expect(result.percentFree).toBe(25);
    expect(JSON.stringify(result)).not.toContain("/synthetic");
    expect(statfs).toHaveBeenCalledWith("/synthetic/uploads");
  });

  it("falls back to the working directory when the uploads directory is missing, and throws when nothing reads", async () => {
    const statfs = vi.fn().mockRejectedValueOnce(new Error("ENOENT")).mockResolvedValueOnce({ bavail: 1, blocks: 10, bsize: 1 });
    expect((await readDiskSpace(statfs, "/synthetic/uploads")).percentFree).toBe(10);
    await expect(readDiskSpace(vi.fn().mockRejectedValue(new Error("down")), "/synthetic/uploads")).rejects.toThrow();
    await expect(readDiskSpace(vi.fn().mockResolvedValue({ bavail: 0, blocks: 0, bsize: 0 }), "/synthetic/uploads")).rejects.toThrow();
  });
});

describe("stored connection test results", () => {
  const stored = (outcome: string, at = minutesAgo(10), ms = 120) =>
    run({ status: outcome === "reachable" ? "ok" : "failing", lastSucceededAt: outcome === "reachable" ? at : null, lastFailedAt: outcome === "reachable" ? null : at, summary: { outcome, ms } });
  const fields = (input: { configured: boolean; run: JobRun | null }) => reachabilityFields("email", "email-reachable", input, now);

  it("says Not set up, with no test, when the service is not configured", () => {
    expect(fields({ configured: false, run: null })).toMatchObject({ state: "watch", resultText: "Not set up, so it was not tested." });
  });

  it("says Not tested yet with the time Never, as unavailable", () => {
    const row = fields({ configured: true, run: run({ status: "never", lastSucceededAt: null, summary: null, ageMs: null }) });
    expect(row).toMatchObject({ state: "unavailable", checkedAt: null, noTimeLabel: "Never" });
    expect(row.resultText).toContain("Not tested yet");
  });

  it("maps reachable, refused and unavailable, and only a fresh reachable is OK", () => {
    expect(fields({ configured: true, run: stored("reachable") }).state).toBe("ok");
    expect(fields({ configured: true, run: stored("refused") }).state).toBe("attention");
    expect(fields({ configured: true, run: stored("unavailable") }).state).toBe("unavailable");
  });

  it("asks to test again when the result is over 24 hours old", () => {
    const old = minutesAgo(25 * 60);
    const reachable = fields({ configured: true, run: stored("reachable", old) });
    expect(reachable.state).toBe("watch");
    expect(reachable.resultText).toContain("Test again");
  });

  it("reads an unreadable stored result as unavailable", () => {
    expect(fields({ configured: true, run: null }).state).toBe("unavailable");
  });
});

describe("the read-only reachability tests", () => {
  const ok = (status = 200, body: unknown = {}) => new Response(JSON.stringify(body), { status });

  beforeEach(() => {
    mocks.getEmailAvailability.mockReturnValue({ deliveryConfigured: true, webhookConfigured: false });
    mocks.getActiveEmailProviderName.mockReturnValue("RESEND");
    mocks.getResendEmailConfiguration.mockReturnValue({ apiKey: "re_synthetic_key", apiUrl: "https://api.resend.test/" });
    mocks.getSquareConfiguration.mockReturnValue({ paymentConfigured: true, apiUrl: "https://connect.square.test", accessToken: "synthetic-token", apiVersion: "2026-07-15" });
  });

  it("asks Resend for the domain list with GET only", async () => {
    const fetcher = vi.fn().mockResolvedValue(ok());
    expect(await checkEmailReachable({ fetcher })).toMatchObject({ outcome: "reachable" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.resend.test/domains");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("counts a restricted (send-only) key as reachable, and refuses other 401 and 403 answers", async () => {
    expect((await checkEmailReachable({ fetcher: vi.fn().mockResolvedValue(ok(401, { name: "restricted_api_key" })) })).outcome).toBe("reachable");
    expect((await checkEmailReachable({ fetcher: vi.fn().mockResolvedValue(ok(401, { name: "invalid_api_key" })) })).outcome).toBe("refused");
    expect((await checkEmailReachable({ fetcher: vi.fn().mockResolvedValue(ok(401, "not json")) })).outcome).toBe("refused");
    expect((await checkEmailReachable({ fetcher: vi.fn().mockResolvedValue(ok(403)) })).outcome).toBe("refused");
  });

  it("reads a 5xx, a network error and a timeout as unavailable", async () => {
    expect((await checkEmailReachable({ fetcher: vi.fn().mockResolvedValue(ok(503)) })).outcome).toBe("unavailable");
    expect((await checkEmailReachable({ fetcher: vi.fn().mockRejectedValue(new TypeError("fetch failed")) })).outcome).toBe("unavailable");
    expect((await checkEmailReachable({ fetcher: vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")) })).outcome).toBe("unavailable");
  });

  it("makes no call when email is not set up", async () => {
    mocks.getEmailAvailability.mockReturnValue({ deliveryConfigured: false, webhookConfigured: false });
    const fetcher = vi.fn();
    expect(await checkEmailReachable({ fetcher })).toEqual({ outcome: "not-configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses the SES connection check, with no send, and times it out", async () => {
    mocks.getActiveEmailProviderName.mockReturnValue("SES");
    mocks.getSesEmailConfiguration.mockReturnValue({ smtpHost: "smtp.synthetic.test" });
    const fetcher = vi.fn();
    expect((await checkEmailReachable({ fetcher, verifySes: vi.fn().mockResolvedValue(undefined) })).outcome).toBe("reachable");
    expect((await checkEmailReachable({ fetcher, verifySes: vi.fn().mockRejectedValue(new Error("down")) })).outcome).toBe("unavailable");
    expect((await checkEmailReachable({ fetcher, timeoutMs: 5, verifySes: vi.fn(() => new Promise(() => undefined)) as never })).outcome).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("asks Square for the locations list with GET only, and maps the answers", async () => {
    const fetcher = vi.fn().mockResolvedValue(ok());
    expect((await checkSquareReachable({ fetcher })).outcome).toBe("reachable");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://connect.square.test/v2/locations");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect((await checkSquareReachable({ fetcher: vi.fn().mockResolvedValue(ok(401)) })).outcome).toBe("refused");
    expect((await checkSquareReachable({ fetcher: vi.fn().mockResolvedValue(ok(500)) })).outcome).toBe("unavailable");
    expect((await checkSquareReachable({ fetcher: vi.fn().mockRejectedValue(new Error("down")) })).outcome).toBe("unavailable");
  });

  it("makes no call when Square is not set up", async () => {
    mocks.getSquareConfiguration.mockReturnValue({ paymentConfigured: false });
    const fetcher = vi.fn();
    expect(await checkSquareReachable({ fetcher })).toEqual({ outcome: "not-configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never returns a key, host or token in a result", async () => {
    const result = await checkSquareReachable({ fetcher: vi.fn().mockResolvedValue(ok(401, { errors: [{ detail: "synthetic-token is bad" }] })) });
    expect(JSON.stringify(result)).not.toMatch(/synthetic|square\.test|Bearer/);
  });
});

describe("Test connections", () => {
  const runConnectionTests = async (deps: Parameters<typeof import("@/modules/system-admin/system-report/connection-tests").runConnectionTests>[0]) =>
    (await vi.importActual<typeof import("@/modules/system-admin/system-report/connection-tests")>("@/modules/system-admin/system-report/connection-tests")).runConnectionTests(deps);

  it("stores each tested result as { outcome, ms } and skips a service that is not set up", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const results = await runConnectionTests({
      email: async () => ({ outcome: "reachable", ms: 90 }),
      square: async () => ({ outcome: "not-configured" }),
      record,
    });
    expect(results).toEqual({ email: "reachable", square: "not-configured" });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith("email-reachability", "SUCCEEDED", { outcome: "reachable", ms: 90 });
  });

  it("records a refused or unavailable result as a failure, and a failed recording never fails the action", async () => {
    const record = vi.fn().mockRejectedValue(new Error("db down"));
    const results = await runConnectionTests({
      email: async () => ({ outcome: "refused", ms: 40 }),
      square: async () => { throw new Error("boom"); },
      record,
    });
    expect(results).toEqual({ email: "refused", square: "unavailable" });
    expect(record).toHaveBeenCalledWith("email-reachability", "FAILED", { outcome: "refused", ms: 40 });
    expect(record).toHaveBeenCalledWith("square-reachability", "FAILED", { outcome: "unavailable", ms: 0 });
  });

  it("is refused for a signed-out visitor and for everyone but a system administrator", async () => {
    const request = () => new Request("https://events.imsda.test/api/admin/system-report/test-connections", { method: "POST", headers: { origin: "https://events.imsda.test" } });
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await POST(request())).status).toBe(403);
    for (const globalRole of ["CLUBS_ADMIN", "EVENT_ADMIN", "USER"]) {
      mocks.getCurrentSession.mockResolvedValue({ user: { id: "u1", globalRole } });
      expect((await POST(request())).status).toBe(403);
    }
    expect(mocks.runConnectionTests).not.toHaveBeenCalled();
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u1", globalRole: "SYSTEM_ADMIN" } });
    mocks.runConnectionTests.mockResolvedValue({ email: "reachable", square: "not-configured" });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: { email: "reachable", square: "not-configured" } });
  });
});

describe("recording job runs", () => {
  beforeEach(() => {
    mocks.getPrisma.mockReturnValue({ systemJobHeartbeat: { upsert: mocks.upsert, findUnique: vi.fn().mockResolvedValue({ lastSucceededAt: new Date(now.getTime() - 60_000), lastFailedAt: null, lastSummary: { due: 1, refreshed: 1, failed: 0 } }) } });
  });

  it("writes a success with its counts, and a failure without touching the last counts", async () => {
    await recordJobRun("calendar-feed-refresh", "SUCCEEDED", { due: 1, refreshed: 1, failed: 0 }, now);
    expect(mocks.upsert).toHaveBeenLastCalledWith({
      where: { job: "calendar-feed-refresh" },
      create: { job: "calendar-feed-refresh", lastSucceededAt: now, lastSummary: { due: 1, refreshed: 1, failed: 0 } },
      update: { lastSucceededAt: now, lastSummary: { due: 1, refreshed: 1, failed: 0 } },
    });
    await recordJobRun("calendar-feed-refresh", "FAILED", undefined, now);
    expect(mocks.upsert).toHaveBeenLastCalledWith({
      where: { job: "calendar-feed-refresh" },
      create: { job: "calendar-feed-refresh", lastFailedAt: now },
      update: { lastFailedAt: now },
    });
  });

  it("reads a run back with its counts, judged stale after the given time", async () => {
    expect(await getJobRun("calendar-feed-refresh", now)).toMatchObject({ status: "ok", summary: { due: 1, refreshed: 1, failed: 0 } });
    expect(await getJobRun("calendar-feed-refresh", now, 30_000)).toMatchObject({ status: "stale" });
  });
});
