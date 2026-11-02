import { beforeEach, describe, expect, it, vi } from "vitest";

/** "Signed-in devices" (#221): only live sessions are listed, the current one is marked, and signing out the others spares it. */

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ attendeeSession: { findMany: mocks.findMany, updateMany: mocks.updateMany } }) }));

import { ATTENDEE_SESSION_IDLE_TIMEOUT_SECONDS, listActiveAttendeeSessions, revokeOtherAttendeeSessions } from "@/modules/attendee-accounts/session-store";

const NOW = new Date("2026-11-09T15:00:00Z");
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

describe("listActiveAttendeeSessions", () => {
  it("asks only for this account's unrevoked, unexpired sessions", async () => {
    mocks.findMany.mockResolvedValue([]);
    await listActiveAttendeeSessions("account-1", "session-1", NOW);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { accountId: "account-1", revokedAt: null, expiresAt: { gt: NOW } },
    }));
  });

  it("drops idle sessions, marks this device, and returns timestamps only", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "session-1", createdAt: ago(3600), lastSeenAt: ago(60) },
      { id: "session-2", createdAt: ago(86_400), lastSeenAt: ago(86_400) },
      { id: "session-idle", createdAt: ago(30 * 86_400), lastSeenAt: ago(ATTENDEE_SESSION_IDLE_TIMEOUT_SECONDS + 60) },
    ]);
    const sessions = await listActiveAttendeeSessions("account-1", "session-1", NOW);
    expect(sessions.map((session) => [session.id, session.isCurrent])).toEqual([["session-1", true], ["session-2", false]]);
    expect(Object.keys(sessions[0]!).sort()).toEqual(["id", "isCurrent", "lastSeenAt", "startedAt"]);
    expect(sessions[0]!.lastSeenAt).toBe(ago(60).toISOString());
  });
});

describe("revokeOtherAttendeeSessions", () => {
  it("revokes every live session of the account except the one kept, and returns the count", async () => {
    mocks.updateMany.mockResolvedValue({ count: 3 });
    await expect(revokeOtherAttendeeSessions("account-1", "session-1", NOW)).resolves.toBe(3);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { accountId: "account-1", revokedAt: null, id: { not: "session-1" } },
      data: { revokedAt: NOW },
    });
  });
});
