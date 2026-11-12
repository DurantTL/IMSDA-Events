/* eslint-disable @typescript-eslint/no-explicit-any -- the fake database receives loosely typed Prisma arguments */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * After a visiting club's window (30 days past its event), nobody can be given a new role on it, and the places that
 * match clubs by name or list them for one event keep to the right clubs (#835). Mocked database; synthetic data only.
 */

const mocks = vi.hoisted(() => {
  const prisma: any = {
    organization: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    event: { findUnique: vi.fn(), findMany: vi.fn() },
    registrationForm: { findFirst: vi.fn() },
    eventLocation: { findMany: vi.fn() },
    clubDirectorGrant: { findMany: vi.fn() },
    clubInvite: { findFirst: vi.fn() },
    attendeeAccount: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma, resolveClubsActor: vi.fn() };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://example.test" }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/access/admin-roles", () => ({ resolveClubsActor: mocks.resolveClubsActor }));

import { VISITING_CLUB_PAST_WINDOW_MESSAGE, visitingClubPastWindow } from "@/modules/visiting-clubs/domain";

const NOW = new Date("2027-05-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const guest = (daysAgo: number) => ({ guestEventId: "event-1", guestEvent: { endsAt: new Date(NOW.getTime() - daysAgo * DAY) } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(async (fn: any) => fn(mocks.prisma));
});

describe("visitingClubPastWindow", () => {
  it("is false for a conference club, inside the window and at exactly 30 days, and true after", () => {
    expect(visitingClubPastWindow({ guestEventId: null, guestEvent: null }, NOW)).toBe(false);
    expect(visitingClubPastWindow({}, NOW)).toBe(false);
    expect(visitingClubPastWindow(guest(29), NOW)).toBe(false);
    expect(visitingClubPastWindow(guest(30), NOW)).toBe(false);
    expect(visitingClubPastWindow(guest(30.01), NOW)).toBe(true);
  });
});

describe("giving a role on a visiting club past its window", () => {
  it("refuses a staff-added role with the plain message and writes nothing", async () => {
    mocks.prisma.organization.findUnique.mockResolvedValue({ id: "g1", name: "Synthetic Guests", type: "CLUB", isActive: true, clubKind: "PATHFINDER", ...guest(45) });
    const { createDirectorGrant } = await import("@/modules/organizations/director-grants-repository");
    await expect(createDirectorGrant("g1", { email: "lead@example.test", role: "DIRECTOR", reason: "Synthetic" } as any, "admin-1", NOW)).rejects.toMatchObject({
      code: "VISITING_CLUB_PAST_WINDOW",
      message: VISITING_CLUB_PAST_WINDOW_MESSAGE,
    });
    expect(mocks.prisma.attendeeAccount.findUnique).not.toHaveBeenCalled();
  });

  it("refuses a People and access invite that names such a club", async () => {
    mocks.resolveClubsActor.mockResolvedValue({ systemAdmin: true });
    mocks.prisma.organization.findMany.mockResolvedValue([{ id: "g1", ...guest(45) }]);
    const { invitePerson } = await import("@/modules/system-admin/people-invite");
    await expect(
      invitePerson("admin-1", { name: "Pat Example", email: "pat@example.test", access: { systemAdmin: false, clubsAdministrator: false, events: [], areaCoordinator: false, clubs: [{ organizationId: "g1", role: "DIRECTOR" }] } } as any, NOW),
    ).rejects.toMatchObject({ code: "INVALID_ACCESS", message: VISITING_CLUB_PAST_WINDOW_MESSAGE });
  });
});

describe("club-list import name matching", () => {
  it("never matches a visiting club, active or not", async () => {
    mocks.prisma.organization.findMany.mockResolvedValue([]);
    mocks.prisma.externalIdentity = { findMany: vi.fn().mockResolvedValue([]) };
    const { annotateImportDrafts } = await import("@/modules/club-imports/repository");
    await annotateImportDrafts([]);
    const clubQuery = mocks.prisma.organization.findMany.mock.calls.map((call: any) => call[0].where).find((where: any) => where.type === "CLUB");
    // No isActive on purpose: the import also matches inactive clubs, but never a visiting one.
    expect(clubQuery).toEqual({ type: "CLUB", guestEventId: null });
  });
});

describe("event-scoped club lists", () => {
  it("form notifications offer conference clubs and only this event's visiting club", async () => {
    mocks.prisma.registrationForm.findFirst.mockResolvedValue({ id: "form-1", versions: [], notifications: [] });
    mocks.prisma.event.findUnique.mockResolvedValue({ audience: "CLUB" });
    mocks.prisma.eventLocation.findMany.mockResolvedValue([]);
    mocks.prisma.organization.findMany.mockResolvedValue([]);
    const { getFormNotificationsPanel } = await import("@/modules/registration-form-notifications/repository");
    await getFormNotificationsPanel("event-1", "form-1").catch(() => undefined);
    const where = mocks.prisma.organization.findMany.mock.calls.map((call: any) => call[0]?.where).find((w: any) => w?.OR);
    expect(where).toEqual({ OR: [{ type: "CLUB", isActive: true, guestEventId: null }, { type: "CLUB", isActive: true, guestEventId: "event-1" }] });
  });

  it("the attachable club list for a team's event is conference clubs plus that event's visiting club", async () => {
    mocks.prisma.organization.findMany.mockResolvedValue([]);
    const { listAttachableClubs } = await import("@/modules/general-link-registrations/repository");
    await listAttachableClubs("event-1");
    expect(mocks.prisma.organization.findMany.mock.calls[0][0].where).toEqual({
      OR: [{ type: "CLUB", isActive: true, guestEventId: null }, { type: "CLUB", isActive: true, guestEventId: "event-1" }],
    });
    mocks.prisma.organization.findMany.mockClear();
    await listAttachableClubs();
    expect(mocks.prisma.organization.findMany.mock.calls[0][0].where).toEqual({ type: "CLUB", isActive: true, guestEventId: null });
  });
});
