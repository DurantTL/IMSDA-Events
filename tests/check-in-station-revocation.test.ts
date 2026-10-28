import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ getPrisma: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));

import {
  revokeAllUserSessions,
  revokeOtherUserSessions,
  revokeUserCheckInStations,
} from "@/modules/access/session-store";

function prisma() {
  const client = {
    userSession: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    checkInStation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  dependencies.getPrisma.mockReturnValue(client);
  return client;
}

const stationRevocation = {
  where: { startedByUserId: "staff_1", revokedAt: null, stoppedAt: null },
  data: { revokedAt: expect.any(Date), revokedByUserId: null },
};

beforeEach(() => vi.clearAllMocks());

describe("ending a person's access ends their check-in stations (#892)", () => {
  it("sign out everywhere revokes the stations as well as the sessions", async () => {
    const client = prisma();
    await revokeAllUserSessions("staff_1");
    expect(client.userSession.updateMany).toHaveBeenCalledOnce();
    expect(client.checkInStation.updateMany).toHaveBeenCalledWith(stationRevocation);
  });

  it("sign out other devices revokes every station, since a station is never this device's session", async () => {
    const client = prisma();
    expect(await revokeOtherUserSessions("staff_1", "current-token")).toBe(2);
    expect(client.checkInStation.updateMany).toHaveBeenCalledWith(stationRevocation);
  });

  it("records the acting admin when one is known", async () => {
    const client = prisma();
    await revokeUserCheckInStations("staff_1", "admin_1");
    expect(client.checkInStation.updateMany).toHaveBeenCalledWith({
      where: stationRevocation.where,
      data: { revokedAt: expect.any(Date), revokedByUserId: "admin_1" },
    });
  });
});
