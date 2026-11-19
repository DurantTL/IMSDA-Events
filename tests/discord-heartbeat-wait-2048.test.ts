import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #2048 review: a Discord post must not keep a host heartbeat waiting past the host's own 5 second limit.
const mocks = vi.hoisted(() => ({ dispatchAlerts: vi.fn(), isActive: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ alertNotification: { updateMany: vi.fn() } }) }));
vi.mock("@/lib/logger", () => ({ logWarn: vi.fn(), logError: vi.fn(), logInfo: vi.fn() }));
vi.mock("@/modules/operations/alerting", () => ({ dispatchAlerts: mocks.dispatchAlerts }));
vi.mock("@/modules/operations/discord-alert-settings", () => ({ DISCORD_HEARTBEAT_TIMEOUT_MS: 2000, isDiscordGroupActive: mocks.isActive }));

import { HOST_JOB_MESSAGE_WAIT_MS, sendHostJobMessage } from "@/modules/operations/host-job-alerts";

beforeEach(() => {
  vi.useFakeTimers();
  mocks.isActive.mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

describe("sendHostJobMessage", () => {
  it("gives Discord a short timeout and stops waiting after a few seconds", async () => {
    mocks.dispatchAlerts.mockReturnValue(new Promise(() => {}));
    let done = false;
    const pending = sendHostJobMessage({ job: "server-autodeploy", outcome: "FAILED", summary: { result: "deploy-failed" } }).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(HOST_JOB_MESSAGE_WAIT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await pending;
    expect(done).toBe(true);
    expect(HOST_JOB_MESSAGE_WAIT_MS).toBeLessThan(5000);
    expect(mocks.dispatchAlerts.mock.calls[0][1]).toMatchObject({ discordTimeoutMs: 2000 });
  });
});
