import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ assertServerEnvAtStartup: vi.fn(), startDataKeyLoading: vi.fn() }));

vi.mock("@/lib/env", () => ({ assertServerEnvAtStartup: mocks.assertServerEnvAtStartup }));
vi.mock("@/lib/data-key/keyring", () => ({ startDataKeyLoading: mocks.startDataKeyLoading }));

import { register } from "@/instrumentation";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NEXT_PHASE", "phase-production-server");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("server startup and the personal-data key (#1652)", () => {
  it("starts loading the key after the environment check, and waits for a quick answer", async () => {
    mocks.startDataKeyLoading.mockResolvedValue(undefined);
    await register();
    expect(mocks.assertServerEnvAtStartup).toHaveBeenCalledBefore(mocks.startDataKeyLoading);
  });

  it("does not hang startup when the vault never answers: it stops waiting after about five seconds", async () => {
    vi.useFakeTimers();
    mocks.startDataKeyLoading.mockReturnValue(new Promise(() => {}));
    let done = false;
    const started = register().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(4_900);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await started;
    expect(done).toBe(true);
  });

  it("does not fail startup when loading throws", async () => {
    mocks.startDataKeyLoading.mockImplementation(() => { throw new Error("boom"); });
    await expect(register()).resolves.toBeUndefined();
  });

  it("is skipped during a production build", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    await register();
    expect(mocks.startDataKeyLoading).not.toHaveBeenCalled();
  });
});
