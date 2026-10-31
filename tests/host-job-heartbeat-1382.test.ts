import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerEnv: vi.fn(),
  recordJobRun: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/lib/logger", async () => {
  const actual = await vi.importActual<typeof import("@/lib/logger")>("@/lib/logger");
  return { ...actual, logError: mocks.logError };
});
vi.mock("@/modules/operations/sweep-heartbeat-repository", () => ({ recordJobRun: mocks.recordJobRun }));

import { POST } from "@/app/api/internal/system-jobs/heartbeat/route";
import {
  autodeployFields,
  dockerCleanupFields,
  runtimeGuardFields,
} from "@/modules/system-admin/system-report/job-signals";
import type { JobRun } from "@/modules/operations/sweep-heartbeat-repository";

/** #1382. Synthetic data only. */
const token = "a-synthetic-heartbeat-token-of-enough-length";
const url = "http://localhost/api/internal/system-jobs/heartbeat";

function send(body: unknown, auth: string | null = `Bearer ${token}`) {
  return POST(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const good = { job: "server-autodeploy", outcome: "SUCCEEDED", summary: { result: "deployed" } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getServerEnv.mockReturnValue({ HOST_JOB_HEARTBEAT_TOKEN: token });
  mocks.recordJobRun.mockResolvedValue(undefined);
});

describe("POST /api/internal/system-jobs/heartbeat", () => {
  it("is 401 when no token is configured, even with a header", async () => {
    mocks.getServerEnv.mockReturnValue({});
    expect((await send(good)).status).toBe(401);
    expect(mocks.recordJobRun).not.toHaveBeenCalled();
  });

  it("is 401 for a missing, wrong, or different-length token, and for a configured token that is too short", async () => {
    expect((await send(good, null)).status).toBe(401);
    expect((await send(good, `Bearer ${token.replace(/.$/, "x")}`)).status).toBe(401);
    expect((await send(good, "Bearer short")).status).toBe(401);
    mocks.getServerEnv.mockReturnValue({ HOST_JOB_HEARTBEAT_TOKEN: "short" });
    expect((await send(good, "Bearer short")).status).toBe(401);
    expect(mocks.recordJobRun).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown job", { ...good, job: "something-else" }],
    ["an extra top-level key", { ...good, extra: 1 }],
    ["an extra summary key", { ...good, summary: { result: "deployed", sha: "abc" } }],
    ["an unknown result word", { ...good, summary: { result: "exploded" } }],
    ["a result that does not match the outcome", { ...good, outcome: "FAILED" }],
    ["a skipped cleanup sent as FAILED", { job: "server-docker-cleanup", outcome: "FAILED", summary: { result: "skipped-lock-busy" } }],
    ["a bad outcome", { ...good, outcome: "OK" }],
    ["a cleanup count out of range", { job: "server-docker-cleanup", outcome: "SUCCEEDED", summary: { result: "cleaned", diskUsedAfterPct: 101 } }],
    ["a negative count", { job: "server-docker-cleanup", outcome: "SUCCEEDED", summary: { result: "cleaned", imagesRemoved: -1 } }],
    ["a string count", { job: "server-docker-cleanup", outcome: "SUCCEEDED", summary: { result: "cleaned", imagesRemoved: "4" } }],
    ["a count on the wrong job", { job: "server-runtime-guard", outcome: "SUCCEEDED", summary: { result: "ok", imagesRemoved: 1 } }],
  ])("is 400 for %s, with a generic message that echoes nothing", async (_name, body) => {
    const response = await send(body);
    expect(response.status).toBe(400);
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain("exploded");
    expect(text).not.toContain("something-else");
    expect(mocks.recordJobRun).not.toHaveBeenCalled();
  });

  it("is 400 for invalid JSON and for an oversized body", async () => {
    expect((await send("not json")).status).toBe(400);
    const oversized = { ...good, summary: { result: "deployed" }, padding: "x".repeat(3000) };
    expect((await send(oversized)).status).toBe(400);
    expect(mocks.recordJobRun).not.toHaveBeenCalled();
  });

  it("records an accepted heartbeat through recordJobRun and answers 200", async () => {
    const response = await send(good);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.recordJobRun).toHaveBeenCalledWith("server-autodeploy", "SUCCEEDED", { result: "deployed" });
  });

  it("records failed runs with their summary, and cleanup counts", async () => {
    await send({ job: "server-autodeploy", outcome: "FAILED", summary: { result: "deploy-failed" } });
    expect(mocks.recordJobRun).toHaveBeenLastCalledWith("server-autodeploy", "FAILED", { result: "deploy-failed" });
    expect((await send({ job: "server-docker-cleanup", outcome: "SUCCEEDED", summary: { result: "cleaned" } })).status).toBe(200);
    await send({ job: "server-docker-cleanup", outcome: "SUCCEEDED", summary: { result: "cleaned", diskUsedBeforePct: 80, diskUsedAfterPct: 71, imagesRemoved: 4 } });
    expect(mocks.recordJobRun).toHaveBeenLastCalledWith("server-docker-cleanup", "SUCCEEDED", { result: "cleaned", diskUsedBeforePct: 80, diskUsedAfterPct: 71, imagesRemoved: 4 });
    await send({ job: "server-docker-cleanup", outcome: "SUCCEEDED", summary: { result: "skipped-lock-busy" } });
    expect(mocks.recordJobRun).toHaveBeenLastCalledWith("server-docker-cleanup", "SUCCEEDED", { result: "skipped-lock-busy" });
    await send({ job: "server-runtime-guard", outcome: "FAILED", summary: { result: "failed" } });
    expect(mocks.recordJobRun).toHaveBeenCalledTimes(5);
  });

  it("is a generic 500 when the write fails", async () => {
    mocks.recordJobRun.mockRejectedValueOnce(new Error("synthetic database failure"));
    const response = await send(good);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("synthetic database failure");
  });
});

const now = new Date("2026-10-31T12:00:00.000Z");
function run(overrides: Partial<JobRun>): JobRun {
  return { status: "ok", lastSucceededAt: "2026-10-31T11:59:00.000Z", lastFailedAt: null, ageMs: 60_000, summary: null, ...overrides };
}
const never = run({ status: "never", lastSucceededAt: null, ageMs: null });

describe("host job report rows", () => {
  it.each([autodeployFields, dockerCleanupFields, runtimeGuardFields])("reads never reported as unavailable, with the setup hint", (fields) => {
    const row = fields("k", never, now);
    expect(row.state).toBe("unavailable");
    expect(row.resultText).toContain("Not reporting yet");
    expect(row.resultText).toContain("heartbeat token");
  });

  it("reads each auto-deploy result", () => {
    const ok = (result: string) => autodeployFields("k", run({ summary: { result } }), now);
    expect(ok("up-to-date")).toMatchObject({ state: "ok", resultText: "Up to date." });
    expect(ok("outside-window")).toMatchObject({ state: "ok", resultText: "A new version is waiting for the night deploy window." });
    expect(ok("image-pending")).toMatchObject({ state: "ok", resultText: "Waiting for the new version's image." });
    expect(ok("deployed")).toMatchObject({ state: "ok", resultText: "Deployed a new version." });
    expect(autodeployFields("k", run({ summary: null }), now)).toMatchObject({ state: "watch", resultText: "It ran, but its counts were not recorded." });
  });

  it("reads a failing auto-deploy from its result word, and stale as watch with its own wording", () => {
    const failing = autodeployFields("k", run({ status: "failing", lastFailedAt: "2026-10-31T11:59:00.000Z", summary: { result: "deploy-failed" } }), now);
    expect(failing).toMatchObject({ state: "attention", resultText: "The latest deploy failed; the live version kept running." });
    expect(autodeployFields("k", run({ status: "failing", summary: null }), now).state).toBe("attention");
    const stale = autodeployFields("k", run({ status: "stale" }), now);
    expect(stale.state).toBe("watch");
    expect(stale.resultText).not.toContain("five-minute");
  });

  it("reads cleanup counts, a busy-lock failure and missing counts", () => {
    expect(dockerCleanupFields("k", run({ summary: { result: "cleaned", diskUsedAfterPct: 71, imagesRemoved: 4 } }), now))
      .toMatchObject({ state: "ok", resultText: "Disk 71% used after cleanup; 4 images removed." });
    expect(dockerCleanupFields("k", run({ summary: { result: "cleaned", diskUsedAfterPct: 71, imagesRemoved: 1 } }), now).resultText).toContain("1 image removed");
    expect(dockerCleanupFields("k", run({ summary: { result: "cleaned" } }), now).state).toBe("watch");
    expect(dockerCleanupFields("k", run({ summary: { result: "skipped-lock-busy" } }), now))
      .toMatchObject({ state: "watch", resultText: "Skipped: a deploy was running. It runs again tomorrow." });
    // Counts left out (Docker did not answer, df unreadable) is watch, never OK.
    expect(dockerCleanupFields("k", run({ summary: { result: "cleaned", diskUsedAfterPct: 71 } }), now))
      .toMatchObject({ state: "watch", resultText: "It ran, but its counts were not recorded." });
    expect(dockerCleanupFields("k", run({ summary: { result: "cleaned", imagesRemoved: 2 } }), now).state).toBe("watch");
    expect(dockerCleanupFields("k", run({ status: "stale" }), now).state).toBe("watch");
  });

  it("reads the runtime guard", () => {
    expect(runtimeGuardFields("k", run({ summary: { result: "ok" } }), now)).toMatchObject({ state: "ok", resultText: "The app container has its settings." });
    expect(runtimeGuardFields("k", run({ status: "failing", summary: { result: "failed" } }), now).state).toBe("attention");
    expect(runtimeGuardFields("k", run({ status: "stale" }), now).state).toBe("watch");
    expect(runtimeGuardFields("k", run({ summary: null }), now).state).toBe("watch");
  });
});
