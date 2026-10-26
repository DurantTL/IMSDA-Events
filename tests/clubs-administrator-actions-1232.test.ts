import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1232: the club management actions Caleb opened to a Clubs Administrator on 2026-10-26, through the real gates
 * (`requireClubsAdministration`, `requireClubOrganizationAdministration`, `requireStaffHealthViewer`,
 * `requireHealthImporter`). Only the session, the grant and organization lookups, and the data behind each route are
 * faked. Allowed: a system administrator and an active Clubs Administrator. Refused: a revoked grant and plain staff;
 * on routes shared with churches, a church. Synthetic data only.
 */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  grantFindFirst: vi.fn(),
  organizationFindUnique: vi.fn(),
  membershipFindMany: vi.fn(),
  listHonors: vi.fn(),
  listDirectorGrants: vi.fn(),
  createDirectorGrant: vi.fn(),
  listMemberHonorHistory: vi.fn(),
  voidMemberHonorEntryAsStaff: vi.fn(),
  rematchBackgroundCheckList: vi.fn(),
  listStaffTransferQueue: vi.fn(),
}));

vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    clubsAdministratorGrant: { findFirst: mocks.grantFindFirst },
    organization: { findUnique: mocks.organizationFindUnique },
    eventMembership: { findMany: mocks.membershipFindMany },
  }),
}));
vi.mock("@/modules/honors/repository", async (importOriginal) => ({ ...(await importOriginal<object>()), listHonors: mocks.listHonors }));
vi.mock("@/modules/organizations/director-grants-repository", () => ({
  listDirectorGrants: mocks.listDirectorGrants,
  createDirectorGrant: mocks.createDirectorGrant,
  revokeDirectorGrant: vi.fn(),
}));
vi.mock("@/modules/honors/member-honor-repository", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listMemberHonorHistory: mocks.listMemberHonorHistory,
  voidMemberHonorEntryAsStaff: mocks.voidMemberHonorEntryAsStaff,
}));
vi.mock("@/modules/background-checks/repository", async (importOriginal) => ({ ...(await importOriginal<object>()), rematchBackgroundCheckList: mocks.rematchBackgroundCheckList }));
vi.mock("@/modules/club-transfers/repository", async (importOriginal) => ({ ...(await importOriginal<object>()), listStaffTransferQueue: mocks.listStaffTransferQueue }));
vi.mock("@/modules/health-records/flag", () => ({ requireHealthRecordsEnabled: () => undefined, healthRecordsEnabled: () => true }));

import { GET as honorCatalog } from "@/app/api/admin/honors/route";
import { GET as directorGrants } from "@/app/api/admin/organizations/[organizationId]/director-grants/route";
import { GET as memberHonors } from "@/app/api/admin/organizations/[organizationId]/roster/[memberId]/honors/route";
import { POST as voidEntry } from "@/app/api/admin/honor-entries/[entryId]/void/route";
import { POST as rematch } from "@/app/api/admin/background-checks/rematch/route";
import { GET as transferQueue } from "@/app/api/admin/club-transfers/route";
import { requireStaffHealthViewer } from "@/modules/health-records/access";
import { healthAuditActor } from "@/modules/health-records/domain";
import { requireHealthImporter } from "@/modules/health-records/import-access";
import { canAdministerClubOrganization } from "@/modules/organizations/access";

type Role = "systemAdmin" | "clubsAdmin" | "revokedClubsAdmin" | "plainStaff";
const roles: Record<Role, { id: string; globalRole: "SYSTEM_ADMIN" | null }> = {
  systemAdmin: { id: "u-sys", globalRole: "SYSTEM_ADMIN" },
  clubsAdmin: { id: "u-clubs", globalRole: null },
  revokedClubsAdmin: { id: "u-revoked", globalRole: null },
  plainStaff: { id: "u-plain", globalRole: null },
};

/** The grant lookup answers for the active grant only; a revoked one is simply not found, as in the database query. */
function signInAs(role: Role) {
  const user = { ...roles[role], email: `${role}@imsda-events.test`, displayName: role };
  mocks.getCurrentSession.mockResolvedValue({ user });
  mocks.grantFindFirst.mockImplementation(async ({ where }: { where: { userId: string; revokedAt: null } }) => (
    role === "clubsAdmin" && where.userId === user.id && where.revokedAt === null ? { id: "grant-1" } : null
  ));
}

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const json = (url: string, method: string, body?: unknown) => new Request(`https://events.imsda.test${url}`, {
  method,
  headers: { "content-type": "application/json", origin: "https://events.imsda.test" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.membershipFindMany.mockResolvedValue([]);
  mocks.organizationFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => (
    where.id === "club-1" ? { type: "CLUB" } : where.id === "church-1" ? { type: "CHURCH" } : null
  ));
  mocks.listHonors.mockResolvedValue([]);
  mocks.listDirectorGrants.mockResolvedValue({ club: { id: "club-1", name: "Test Pathfinders" }, grants: [] });
  mocks.listMemberHonorHistory.mockResolvedValue({ entries: [] });
  mocks.voidMemberHonorEntryAsStaff.mockResolvedValue(undefined);
  mocks.rematchBackgroundCheckList.mockResolvedValue(undefined);
  mocks.listStaffTransferQueue.mockResolvedValue([]);
});

type Call = { name: string; call: () => Promise<Response>; effect: () => ReturnType<typeof vi.fn> };
const clubWideCalls: Call[] = [
  { name: "the honor catalog", call: () => honorCatalog(json("/api/admin/honors", "GET")), effect: () => mocks.listHonors },
  { name: "Sterling Volunteers rematch", call: () => rematch(json("/api/admin/background-checks/rematch", "POST")), effect: () => mocks.rematchBackgroundCheckList },
  { name: "the member transfer queue", call: () => transferQueue(json("/api/admin/club-transfers", "GET")), effect: () => mocks.listStaffTransferQueue },
  { name: "voiding an honor entry", call: () => voidEntry(json("/api/admin/honor-entries/e-1/void", "POST", { reason: "Entered twice by mistake" }), ctx({ entryId: "e-1" })), effect: () => mocks.voidMemberHonorEntryAsStaff },
];
const clubOnlyCalls = (organizationId: string): Call[] => [
  { name: "club admins (director grants)", call: () => directorGrants(json(`/api/admin/organizations/${organizationId}/director-grants`, "GET"), ctx({ organizationId })), effect: () => mocks.listDirectorGrants },
  { name: "a member's honor history", call: () => memberHonors(json(`/api/admin/organizations/${organizationId}/roster/m-1/honors`, "GET"), ctx({ organizationId, memberId: "m-1" })), effect: () => mocks.listMemberHonorHistory },
];

describe("club management routes: system administrators and Clubs Administrators", () => {
  for (const area of [...clubWideCalls, ...clubOnlyCalls("club-1")]) {
    for (const role of ["systemAdmin", "clubsAdmin"] as const) {
      it(`${area.name}: lets ${role} in`, async () => {
        signInAs(role);
        expect((await area.call()).status).toBeLessThan(300);
        expect(area.effect()).toHaveBeenCalledTimes(1);
      });
    }
    for (const role of ["revokedClubsAdmin", "plainStaff"] as const) {
      it(`${area.name}: refuses ${role} with a 403 and does nothing`, async () => {
        signInAs(role);
        expect((await area.call()).status).toBe(403);
        expect(area.effect()).not.toHaveBeenCalled();
      });
    }
    it(`${area.name}: asks for sign-in (401) when signed out`, async () => {
      mocks.getCurrentSession.mockResolvedValue({ user: null });
      expect((await area.call()).status).toBe(401);
      expect(area.effect()).not.toHaveBeenCalled();
    });
  }

  it("records the actor exactly as for a system administrator: their own user id", async () => {
    signInAs("clubsAdmin");
    await voidEntry(json("/api/admin/honor-entries/e-1/void", "POST", { reason: "Entered twice by mistake" }), ctx({ entryId: "e-1" }));
    expect(mocks.voidMemberHonorEntryAsStaff).toHaveBeenLastCalledWith("e-1", "Entered twice by mistake", "u-clubs");
    signInAs("systemAdmin");
    await voidEntry(json("/api/admin/honor-entries/e-1/void", "POST", { reason: "Entered twice by mistake" }), ctx({ entryId: "e-1" }));
    expect(mocks.voidMemberHonorEntryAsStaff).toHaveBeenLastCalledWith("e-1", "Entered twice by mistake", "u-sys");
  });

  it("takes effect on the next request: a revoke is read from the database each time", async () => {
    signInAs("clubsAdmin");
    expect((await clubWideCalls[0]!.call()).status).toBe(200);
    signInAs("revokedClubsAdmin");
    expect((await clubWideCalls[0]!.call()).status).toBe(403);
  });
});

describe("routes shared with churches: a Clubs Administrator gets clubs only", () => {
  for (const area of clubOnlyCalls("church-1")) {
    it(`${area.name}: refuses a Clubs Administrator for a church (403), reading nothing`, async () => {
      signInAs("clubsAdmin");
      expect((await area.call()).status).toBe(403);
      expect(area.effect()).not.toHaveBeenCalled();
    });
    it(`${area.name}: refuses a Clubs Administrator for an organization that does not exist`, async () => {
      signInAs("clubsAdmin");
      const missing = clubOnlyCalls("missing-org").find((candidate) => candidate.name === area.name)!;
      expect((await missing.call()).status).toBe(403);
      expect(area.effect()).not.toHaveBeenCalled();
    });
    it(`${area.name}: still lets a system administrator in, as before`, async () => {
      signInAs("systemAdmin");
      expect((await area.call()).status).toBeLessThan(300);
    });
  }

  it("reads the organization type server-side for the page-level check too", async () => {
    expect(await canAdministerClubOrganization(roles.systemAdmin, "church-1")).toBe(true);
    signInAs("clubsAdmin");
    expect(await canAdministerClubOrganization(roles.clubsAdmin, "club-1")).toBe(true);
    expect(await canAdministerClubOrganization(roles.clubsAdmin, "church-1")).toBe(false);
    expect(await canAdministerClubOrganization(roles.revokedClubsAdmin, "club-1")).toBe(false);
    expect(await canAdministerClubOrganization(roles.plainStaff, "club-1")).toBe(false);
  });
});

describe("the health record import", () => {
  it("admits a system administrator and an active Clubs Administrator, with the audit actor marked for the latter", async () => {
    signInAs("clubsAdmin");
    const viewer = requireHealthImporter(await requireStaffHealthViewer());
    expect(viewer).toMatchObject({ kind: "SYSTEM_ADMIN", userId: "u-clubs", viaClubsAdministrator: true });
    expect(healthAuditActor(viewer)).toEqual({ actorUserId: "u-clubs", metadata: { viewerKind: "SYSTEM_ADMIN", actorRole: "CLUBS_ADMINISTRATOR" } });
    signInAs("systemAdmin");
    const admin = requireHealthImporter(await requireStaffHealthViewer());
    expect(healthAuditActor(admin)).toEqual({ actorUserId: "u-sys", metadata: { viewerKind: "SYSTEM_ADMIN" } });
  });

  it("refuses a revoked grant and plain staff", async () => {
    for (const role of ["revokedClubsAdmin", "plainStaff"] as const) {
      signInAs(role);
      await expect(requireStaffHealthViewer()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("still refuses anyone acting as a club director, and every other kind of viewer", () => {
    expect(() => requireHealthImporter({ kind: "SYSTEM_ADMIN", userId: "u-clubs", actAsId: "act-1", viaClubsAdministrator: true })).toThrow(/Clubs Administrator/);
    expect(() => requireHealthImporter({ kind: "SYSTEM_ADMIN", userId: "u-sys", actAsId: "act-1" })).toThrow();
    expect(() => requireHealthImporter({ kind: "HEALTH_ROLE", userId: "u-event", eventIds: ["evt-a"] })).toThrow();
  });
});
