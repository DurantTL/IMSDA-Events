import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  getOutboxQueueHealth: vi.fn(),
  getReleaseIdentity: vi.fn(),
  getSweepHeartbeat: vi.fn(),
  getBackupStatus: vi.fn(),
  getCurrentSessionPassive: vi.fn(),
  dispatchUnsuppressedAlert: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));
vi.mock("@/modules/communications/outbox-sweep", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/communications/outbox-sweep")>()),
  getOutboxQueueHealth: dependencies.getOutboxQueueHealth,
}));
vi.mock("@/modules/access/current-session", () => ({
  getCurrentSessionPassive: dependencies.getCurrentSessionPassive,
}));
vi.mock("@/modules/operations/alerting", () => ({
  dispatchUnsuppressedAlert: dependencies.dispatchUnsuppressedAlert,
}));
vi.mock("@/lib/release", () => ({
  getReleaseIdentity: dependencies.getReleaseIdentity,
}));
vi.mock("@/modules/operations/sweep-heartbeat-repository", () => ({
  getSweepHeartbeat: dependencies.getSweepHeartbeat,
}));
vi.mock("@/modules/operations/backup-status-repository", () => ({
  getBackupStatus: dependencies.getBackupStatus,
}));

import { resetServerEnvCache } from "@/lib/env";
import { GET } from "@/app/api/health/route";

const healthyQueue = {
  status: "ok" as const,
  reasons: [] as string[],
  pending: 1,
  due: 0,
  processing: 0,
  failed: 0,
  oldestDueAgeMs: null,
  eventsWithDueMessages: 0,
};

const recentSweep = {
  status: "ok" as const,
  lastSucceededAt: "2026-10-09T12:00:00.000Z",
  lastFailedAt: null,
  ageMs: 60_000,
};

const healthyBackups = {
  status: "ok" as const,
  stale: false,
  lastSuccessAt: "2026-10-09T03:00:00.000Z",
  lastRunAt: "2026-10-09T03:00:00.000Z",
  lastRunOk: true,
  dumpBytes: 5000,
  assetsBytes: 700,
  offsiteOk: true,
  lastOffsiteSuccessAt: "2026-10-09T03:00:00.000Z",
  lastRehearsalAt: "2026-10-05T03:10:00.000Z",
  lastRehearsalOk: true,
  needsAttention: false,
};

const sweepToken = "synthetic-sweep-token-0123456789-abcdefghij";
const monitorToken = "synthetic-monitor-token-0123456789-abcdefgh";

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.getPrisma.mockReturnValue({ $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) });
  dependencies.getOutboxQueueHealth.mockResolvedValue(healthyQueue);
  dependencies.getSweepHeartbeat.mockResolvedValue(recentSweep);
  dependencies.getBackupStatus.mockResolvedValue(healthyBackups);
  dependencies.getCurrentSessionPassive.mockResolvedValue({ user: null });
  dependencies.dispatchUnsuppressedAlert.mockResolvedValue(undefined);
  resetServerEnvCache();
  vi.stubEnv("OUTBOX_SWEEP_TOKEN", sweepToken);
  vi.stubEnv("HEALTH_MONITOR_TOKEN", monitorToken);
  dependencies.getReleaseIdentity.mockReturnValue({
    sha: "d27839dcabf253111bf4a014cb526db3b1c57469",
    buildId: "next-build-id",
  });
});

/** The wrapper needs a request: Next always supplies one. */
function healthRequest(token?: string) {
  return new Request("https://events.imsda.test/api/health", {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

function adminSession(globalRole: string) {
  dependencies.getCurrentSessionPassive.mockResolvedValue({ user: { id: "user-1", globalRole } });
}

function databaseDown() {
  dependencies.getPrisma.mockReturnValue({
    $queryRaw: vi.fn().mockRejectedValue(new Error("connection refused")),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnvCache();
});

describe("health endpoint, public answer (#1400)", () => {
  it("returns only status, time and the database check", async () => {
    const response = await GET(healthRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["checkedAt", "services", "status"]);
    expect(body.status).toBe("ok");
    expect(body.services).toEqual({ database: "ok" });
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
    const text = JSON.stringify(body);
    for (const key of ["release", "encryptionKey", "backups", "messageOutbox", "outboxSweep", "sha"]) {
      expect(text).not.toContain(key);
    }
  });

  it("does not run the outbox, sweep, backup or release lookups", async () => {
    await GET(healthRequest());
    expect(dependencies.getOutboxQueueHealth).not.toHaveBeenCalled();
    expect(dependencies.getSweepHeartbeat).not.toHaveBeenCalled();
    expect(dependencies.getBackupStatus).not.toHaveBeenCalled();
    expect(dependencies.getReleaseIdentity).not.toHaveBeenCalled();
  });

  it("stays ok when backups are stale and the outbox is backed up", async () => {
    dependencies.getBackupStatus.mockResolvedValue({ ...healthyBackups, status: "stale", stale: true, needsAttention: true });
    dependencies.getOutboxQueueHealth.mockResolvedValue({ ...healthyQueue, status: "degraded", due: 90 });
    const response = await GET(healthRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", services: { database: "ok" } });
  });

  it("returns 503 with a minimal body and still alerts when the database is down", async () => {
    databaseDown();
    const response = await GET(healthRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      status: "degraded",
      checkedAt: expect.any(String),
      services: { database: "unavailable" },
    });
    expect(dependencies.dispatchUnsuppressedAlert).toHaveBeenCalledTimes(1);
  });

  it("adds release and key source (not the outbox queries) to the 503 for a token holder", async () => {
    databaseDown();
    const response = await GET(healthRequest(sweepToken));
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(Object.keys(body).sort()).toEqual(["checkedAt", "encryptionKey", "release", "services", "status"]);
    expect(body.services).toEqual({ application: "ok", database: "unavailable" });
    expect(dependencies.getOutboxQueueHealth).not.toHaveBeenCalled();
    expect(dependencies.dispatchUnsuppressedAlert).toHaveBeenCalledTimes(1);
  });

  it("does not look up a session when the database is down", async () => {
    databaseDown();
    await GET(healthRequest());
    expect(dependencies.getCurrentSessionPassive).not.toHaveBeenCalled();
  });

  it("sends Cache-Control: no-store on every response", async () => {
    expect((await GET(healthRequest())).headers.get("cache-control")).toBe("no-store");
    expect((await GET(healthRequest(sweepToken))).headers.get("cache-control")).toBe("no-store");
    databaseDown();
    expect((await GET(healthRequest())).headers.get("cache-control")).toBe("no-store");
  });
});

describe("health endpoint, who sees the detail (#1400)", () => {
  async function isFull(response: Response) {
    const body = await response.json();
    return "release" in body && "messageOutbox" in body && "backups" in body && "encryptionKey" in body;
  }

  it("shows the full response to the sweep token", async () => {
    const response = await GET(healthRequest(sweepToken));
    expect(await isFull(response)).toBe(true);
    expect(dependencies.getOutboxQueueHealth).toHaveBeenCalled();
  });

  it("shows the full response to the monitor token", async () => {
    expect(await isFull(await GET(healthRequest(monitorToken)))).toBe(true);
  });

  it("shows the public answer for a wrong token, a wrong length or no token", async () => {
    expect(await isFull(await GET(healthRequest("synthetic-wrong-token-0123456789-abcdefghijk")))).toBe(false);
    expect(await isFull(await GET(healthRequest(`${sweepToken}x`)))).toBe(false);
    expect(await isFull(await GET(healthRequest(sweepToken.slice(0, -1))))).toBe(false);
    expect(await isFull(await GET(healthRequest("")))).toBe(false);
    expect(await isFull(await GET(healthRequest()))).toBe(false);
  });

  it("fails closed when the monitor token is unset or shorter than 32 characters", async () => {
    resetServerEnvCache();
    vi.stubEnv("HEALTH_MONITOR_TOKEN", "");
    expect(await isFull(await GET(healthRequest("")))).toBe(false);
    expect(await isFull(await GET(healthRequest(monitorToken)))).toBe(false);

    resetServerEnvCache();
    vi.stubEnv("HEALTH_MONITOR_TOKEN", "short-token");
    expect(await isFull(await GET(healthRequest("short-token")))).toBe(false);
  });

  it("fails closed when no sweep token is configured", async () => {
    resetServerEnvCache();
    vi.stubEnv("OUTBOX_SWEEP_TOKEN", "");
    expect(await isFull(await GET(healthRequest(sweepToken)))).toBe(false);
  });

  it("shows the full response to a system administrator session", async () => {
    adminSession("SYSTEM_ADMIN");
    expect(await isFull(await GET(healthRequest()))).toBe(true);
  });

  it("shows the public answer to a signed-in user who is not a system administrator", async () => {
    adminSession("USER");
    expect(await isFull(await GET(healthRequest()))).toBe(false);
  });

  it("shows the public answer when the session lookup throws", async () => {
    dependencies.getCurrentSessionPassive.mockRejectedValue(new Error("cookies unavailable"));
    const response = await GET(healthRequest());
    expect(response.status).toBe(200);
    expect(await isFull(response)).toBe(false);
  });

  it("does not look up a session for a token holder", async () => {
    await GET(healthRequest(monitorToken));
    expect(dependencies.getCurrentSessionPassive).not.toHaveBeenCalled();
  });
});

describe("health endpoint, full detail", () => {
  it("shows how the encryption key is loaded and never its value", async () => {
    const syntheticKey = "synthetic-health-key-0123456789-abcdefghijklmno";
    // A session, not a token: an environment with a missing key file cannot be read for tokens.
    adminSession("SYSTEM_ADMIN");
    resetServerEnvCache();
    vi.stubEnv("SECRET_ENCRYPTION_KEY_FILE", "");
    vi.stubEnv("SECRET_ENCRYPTION_KEY", syntheticKey);
    const response = await GET(healthRequest());
    const text = await response.text();
    expect(JSON.parse(text).encryptionKey).toEqual({ configured: true, source: "env" });
    expect(text).not.toContain(syntheticKey);

    // Resolved once at startup: a later change is not re-read per request.
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "");
    expect((await (await GET(healthRequest())).json()).encryptionKey).toEqual({ configured: true, source: "env" });

    resetServerEnvCache();
    vi.stubEnv("SECRET_ENCRYPTION_KEY_FILE", "/nonexistent/imsda-test-key");
    const missing = await (await GET(healthRequest())).json();
    expect(missing.encryptionKey).toEqual({ configured: false, source: "file" });

    resetServerEnvCache();
    vi.stubEnv("SECRET_ENCRYPTION_KEY_FILE", "");
    const none = await (await GET(healthRequest())).json();
    expect(none.encryptionKey).toEqual({ configured: false, source: null });
  });

  it("reports ok when the database and the outbox are both healthy", async () => {
    const response = await GET(healthRequest(sweepToken));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      release: {
        sha: "d27839dcabf253111bf4a014cb526db3b1c57469",
        buildId: "next-build-id",
      },
      services: { application: "ok", database: "ok", messageOutbox: "ok" },
    });
  });

  it("no longer reports healthy while email delivery is broken", async () => {
    dependencies.getOutboxQueueHealth.mockResolvedValue({
      ...healthyQueue,
      status: "degraded",
      due: 90,
      reasons: ["90 messages are due and undelivered"],
    });

    const response = await GET(healthRequest(sweepToken));
    const body = await response.json();

    // Still 200: a backed-up queue must not make the orchestrator restart a
    // container that is otherwise serving registrations.
    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.messageOutbox.reasons).toEqual(["90 messages are due and undelivered"]);
  });

  it("returns 503 only when the database is unreachable", async () => {
    dependencies.getPrisma.mockReturnValue({
      $queryRaw: vi.fn().mockRejectedValue(new Error("connection refused")),
    });

    const response = await GET(healthRequest(sweepToken));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      services: { database: "unavailable" },
    });
  });

  it("stays up and marks the outbox unknown when its own check fails", async () => {
    dependencies.getOutboxQueueHealth.mockRejectedValue(new Error("query failed"));

    const response = await GET(healthRequest(sweepToken));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      services: { messageOutbox: "unknown" },
      messageOutbox: null,
    });
  });

  it("reports degraded when the scheduled sweep has gone quiet", async () => {
    dependencies.getSweepHeartbeat.mockResolvedValue({
      ...recentSweep,
      status: "stale",
      ageMs: 40 * 60_000,
    });

    const response = await GET(healthRequest(sweepToken));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "degraded",
      services: { outboxSweep: "stale" },
      outboxSweep: { ageMs: 40 * 60_000 },
    });
  });

  it("does not degrade before the first sweep has reported", async () => {
    dependencies.getSweepHeartbeat.mockResolvedValue({
      status: "never",
      lastSucceededAt: null,
      lastFailedAt: null,
      ageMs: null,
    });

    const response = await GET(healthRequest(sweepToken));

    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      services: { outboxSweep: "never" },
    });
  });

  it("marks the sweep unknown when its heartbeat cannot be read", async () => {
    dependencies.getSweepHeartbeat.mockRejectedValue(new Error("query failed"));

    const response = await GET(healthRequest(sweepToken));

    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      services: { outboxSweep: "unknown" },
      outboxSweep: null,
    });
  });

  it("shows the backup block without secrets and stays ok", async () => {
    const response = await GET(healthRequest(sweepToken));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.services.backups).toBe("ok");
    // Public endpoint: no sizes or off-site detail.
    expect(body.backups).toEqual({
      status: "ok",
      stale: false,
      needsAttention: false,
      lastSuccessAt: healthyBackups.lastSuccessAt,
      lastRehearsalAt: healthyBackups.lastRehearsalAt,
    });
    expect(JSON.stringify(body)).not.toContain("dumpBytes");
    expect(JSON.stringify(body)).not.toContain("offsite");
  });

  it("reports degraded, not 503, when the last backup is stale", async () => {
    dependencies.getBackupStatus.mockResolvedValue({
      ...healthyBackups,
      status: "stale",
      stale: true,
      needsAttention: true,
    });

    const response = await GET(healthRequest(sweepToken));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "degraded",
      services: { backups: "stale" },
      backups: { stale: true },
    });
  });

  it("reports degraded when the off-site copy failed", async () => {
    dependencies.getBackupStatus.mockResolvedValue({
      ...healthyBackups,
      offsiteOk: false,
      needsAttention: true,
    });

    const response = await GET(healthRequest(sweepToken));

    const body = await response.json();
    expect(body.status).toBe("degraded");
    expect(body.backups.needsAttention).toBe(true);
    expect(body.backups).not.toHaveProperty("offsiteOk");
  });

  it("does not degrade before the first backup has reported", async () => {
    dependencies.getBackupStatus.mockResolvedValue({
      ...healthyBackups,
      status: "never",
      lastSuccessAt: null,
      lastRunAt: null,
      lastRunOk: null,
      offsiteOk: null,
      lastRehearsalAt: null,
      lastRehearsalOk: null,
    });

    const response = await GET(healthRequest(sweepToken));

    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      services: { backups: "never" },
    });
  });

  it("marks backups unknown when their status cannot be read", async () => {
    dependencies.getBackupStatus.mockRejectedValue(new Error("query failed"));

    const response = await GET(healthRequest(sweepToken));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      services: { backups: "unknown" },
      backups: null,
    });
  });
});
