/* eslint-disable @typescript-eslint/no-explicit-any -- the fake database receives loosely typed Prisma arguments */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A visiting club's roles end 30 days after its event ends (#835). Mocked database; synthetic ids only.
 */

const mocks = vi.hoisted(() => {
  const prisma: any = {
    clubDirectorGrant: { findMany: vi.fn(), updateMany: vi.fn() },
    clubInvite: { findMany: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma, writeAuditLog: vi.fn() };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { endVisitingClubAccess } from "@/modules/visiting-clubs/access-end";
import { VISITING_CLUB_ACCESS_DAYS_AFTER_EVENT, visitingClubAccessCutoff } from "@/modules/visiting-clubs/domain";

const NOW = new Date("2027-05-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const grant = (id: string, role = "DIRECTOR", organizationId = "guest-1") => ({ id, organizationId, role, organization: { guestEventId: "event-1" } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(async (fn: any) => fn(mocks.prisma));
  mocks.prisma.clubDirectorGrant.findMany.mockResolvedValue([]);
  mocks.prisma.clubDirectorGrant.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.clubInvite.findMany.mockResolvedValue([]);
  mocks.prisma.clubInvite.updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.useRealTimers());

describe("the visiting club access window", () => {
  it("is 30 days, and an event that ended exactly 30 days ago is still inside it", () => {
    expect(VISITING_CLUB_ACCESS_DAYS_AFTER_EVENT).toBe(30);
    expect(visitingClubAccessCutoff(NOW).getTime()).toBe(NOW.getTime() - 30 * DAY);
  });

  it("asks only for open roles on guest clubs whose event ended before the cutoff (strictly)", async () => {
    await endVisitingClubAccess();
    const where = mocks.prisma.clubDirectorGrant.findMany.mock.calls[0][0].where;
    expect(where.revokedAt).toBeNull();
    expect(where.OR).toEqual([{ effectiveTo: null }, { effectiveTo: { gt: NOW } }]);
    expect(where.organization).toEqual({ guestEventId: { not: null }, guestEvent: { endsAt: { lt: new Date(NOW.getTime() - 30 * DAY) } } });
    // Every role is covered: the query does not filter by role.
    expect(where.role).toBeUndefined();
  });
});

describe("endVisitingClubAccess", () => {
  it("does nothing and writes nothing when no role is due", async () => {
    await expect(endVisitingClubAccess()).resolves.toEqual({ ended: 0, clubs: 0, invitesCancelled: 0 });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("ends every due role at now, counts roles and clubs, and audits each with ids only", async () => {
    mocks.prisma.clubDirectorGrant.findMany.mockResolvedValue([grant("g1"), grant("g2", "REGISTRAR"), grant("g3", "DIRECTOR", "guest-2")]);
    await expect(endVisitingClubAccess()).resolves.toEqual({ ended: 3, clubs: 2, invitesCancelled: 0 });
    for (const call of mocks.prisma.clubDirectorGrant.updateMany.mock.calls) {
      expect(call[0].data).toEqual({ effectiveTo: NOW });
      expect(call[0].where.revokedAt).toBeNull();
    }
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(3);
    expect(mocks.writeAuditLog.mock.calls[1][0]).toMatchObject({
      action: "VISITING_CLUB_ACCESS_ENDED",
      entityType: "ClubDirectorGrant",
      entityId: "g2",
      eventId: "event-1",
      metadata: { grantId: "g2", organizationId: "guest-1", role: "REGISTRAR" },
    });
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toMatch(/@|name/i);
  });

  it("skips a role another run already ended, with no count and no audit entry", async () => {
    mocks.prisma.clubDirectorGrant.findMany.mockResolvedValue([grant("g1"), grant("g2")]);
    mocks.prisma.clubDirectorGrant.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    await expect(endVisitingClubAccess()).resolves.toEqual({ ended: 1, clubs: 1, invitesCancelled: 0 });
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog.mock.calls[0][0].entityId).toBe("g2");
  });

  it("cancels open invites on those clubs, skips one another run already cancelled, and audits ids only", async () => {
    mocks.prisma.clubInvite.findMany.mockResolvedValue([
      { id: "i1", organizationId: "guest-1", organization: { guestEventId: "event-1" } },
      { id: "i2", organizationId: "guest-1", organization: { guestEventId: "event-1" } },
    ]);
    mocks.prisma.clubInvite.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(endVisitingClubAccess()).resolves.toEqual({ ended: 0, clubs: 0, invitesCancelled: 1 });
    expect(mocks.prisma.clubInvite.findMany.mock.calls[0][0].where.organization.guestEvent).toEqual({ endsAt: { lt: new Date(NOW.getTime() - 30 * DAY) } });
    expect(mocks.prisma.clubInvite.updateMany.mock.calls[0][0]).toEqual({ where: { id: "i1", status: { in: ["PENDING", "SENT"] } }, data: { status: "CANCELLED", cancelledAt: NOW } });
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog.mock.calls[0][0]).toMatchObject({ action: "VISITING_CLUB_INVITE_CANCELLED", entityId: "i1", metadata: { inviteId: "i1", organizationId: "guest-1" } });
  });

  it("runs without a strict isolation level, because each update is guarded", async () => {
    mocks.prisma.clubDirectorGrant.findMany.mockResolvedValue([grant("g1")]);
    await endVisitingClubAccess();
    expect(mocks.prisma.$transaction.mock.calls[0]).toHaveLength(1);
  });

  it("leaves the club itself active", async () => {
    mocks.prisma.clubDirectorGrant.findMany.mockResolvedValue([grant("g1")]);
    await endVisitingClubAccess();
    expect(mocks.prisma.organization).toBeUndefined();
  });
});
