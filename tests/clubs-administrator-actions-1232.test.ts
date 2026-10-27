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
  listRegistrationMoves: vi.fn(),
  approveRegistrationMove: vi.fn(),
  skipRegistrationMove: vi.fn(),
  previewHealthImport: vi.fn(),
  readHealthImportUpload: vi.fn(),
  requireRosterAccess: vi.fn(),
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
vi.mock("@/modules/club-transfers/repository", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listStaffTransferQueue: mocks.listStaffTransferQueue,
  listRegistrationMoves: mocks.listRegistrationMoves,
  approveRegistrationMove: mocks.approveRegistrationMove,
  skipRegistrationMove: mocks.skipRegistrationMove,
}));
vi.mock("@/modules/health-records/import-repository", () => ({ previewHealthImport: mocks.previewHealthImport, applyHealthImport: vi.fn() }));
vi.mock("@/modules/health-records/import-upload", () => ({ readHealthImportUpload: mocks.readHealthImportUpload }));
vi.mock("@/modules/club-rosters/access", async (importOriginal) => ({ ...(await importOriginal<object>()), requireRosterAccess: mocks.requireRosterAccess }));
vi.mock("@/modules/health-records/flag", () => ({ requireHealthRecordsEnabled: () => undefined, healthRecordsEnabled: () => true }));

import { GET as honorCatalog } from "@/app/api/admin/honors/route";
import { GET as directorGrants } from "@/app/api/admin/organizations/[organizationId]/director-grants/route";
import { GET as memberHonors } from "@/app/api/admin/organizations/[organizationId]/roster/[memberId]/honors/route";
import { POST as voidEntry } from "@/app/api/admin/honor-entries/[entryId]/void/route";
import { POST as rematch } from "@/app/api/admin/background-checks/rematch/route";
import { GET as transferQueue } from "@/app/api/admin/club-transfers/route";
import { PATCH as revokeDirectorGrant } from "@/app/api/admin/organizations/[organizationId]/director-grants/[grantId]/route";
import { POST as createDirectorGrant } from "@/app/api/admin/organizations/[organizationId]/director-grants/route";
import { PATCH as saveClubProfile } from "@/app/api/admin/organizations/[organizationId]/profile/route";
import { POST as moveImportYear } from "@/app/api/admin/organizations/[organizationId]/club-import-year/route";
import { GET as orgHonors } from "@/app/api/admin/organizations/[organizationId]/honors/route";
import { GET as movesList } from "@/app/api/admin/club-transfers/registration-moves/route";
import { POST as moveApprove } from "@/app/api/admin/club-transfers/registration-moves/[moveId]/approve/route";
import { POST as moveSkip } from "@/app/api/admin/club-transfers/registration-moves/[moveId]/skip/route";
import { POST as healthImportPreview } from "@/app/api/staff/health-import/preview/route";
import { requireHealthViewerForClub, requireStaffHealthViewer } from "@/modules/health-records/access";
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
  mocks.listRegistrationMoves.mockResolvedValue([]);
  mocks.approveRegistrationMove.mockResolvedValue({});
  mocks.skipRegistrationMove.mockResolvedValue({});
  mocks.readHealthImportUpload.mockResolvedValue({ files: [] });
  mocks.previewHealthImport.mockResolvedValue({ matched: 0 });
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

  const churchWrites: Array<[string, () => Promise<Response>]> = [
    ["assigning a club director", () => createDirectorGrant(json("/api/admin/organizations/church-1/director-grants", "POST", {}), ctx({ organizationId: "church-1" }))],
    ["revoking a club director", () => revokeDirectorGrant(json("/api/admin/organizations/church-1/director-grants/g-1", "PATCH", {}), ctx({ organizationId: "church-1", grantId: "g-1" }))],
    ["saving a club profile", () => saveClubProfile(json("/api/admin/organizations/church-1/profile", "PATCH", {}), ctx({ organizationId: "church-1" }))],
    ["moving a club import's year", () => moveImportYear(json("/api/admin/organizations/church-1/club-import-year", "POST", {}), ctx({ organizationId: "church-1" }))],
    ["the club honors list", () => orgHonors(json("/api/admin/organizations/church-1/honors", "GET"), ctx({ organizationId: "church-1" }))],
  ];
  for (const [name, call] of churchWrites) {
    it(`${name}: refuses a Clubs Administrator for a church (403) before reading the body`, async () => {
      signInAs("clubsAdmin");
      const response = await call();
      expect(response.status).toBe(403);
      expect(mocks.createDirectorGrant).not.toHaveBeenCalled();
    });
    it(`${name}: refuses a revoked grant and plain staff for a club (403)`, async () => {
      for (const role of ["revokedClubsAdmin", "plainStaff"] as const) {
        signInAs(role);
        const response = await call();
        expect(response.status).toBe(403);
      }
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

describe("event registration-move approvals stay system-administrator only", () => {
  const moveCalls: Array<[string, () => Promise<Response>, () => ReturnType<typeof vi.fn>]> = [
    ["the pending list", () => movesList(json("/api/admin/club-transfers/registration-moves", "GET")), () => mocks.listRegistrationMoves],
    ["approving a move", () => moveApprove(json("/api/admin/club-transfers/registration-moves/m-1/approve", "POST", { confirm: true }), ctx({ moveId: "m-1" })), () => mocks.approveRegistrationMove],
    ["skipping a move", () => moveSkip(json("/api/admin/club-transfers/registration-moves/m-1/skip", "POST", {}), ctx({ moveId: "m-1" })), () => mocks.skipRegistrationMove],
  ];
  for (const [name, call, effect] of moveCalls) {
    it(`${name}: refuses an active Clubs Administrator, a revoked grant and plain staff`, async () => {
      for (const role of ["clubsAdmin", "revokedClubsAdmin", "plainStaff"] as const) {
        signInAs(role);
        expect((await call()).status).toBe(403);
      }
      expect(effect()).not.toHaveBeenCalled();
    });
    it(`${name}: still lets a system administrator in`, async () => {
      signInAs("systemAdmin");
      expect((await call()).status).toBeLessThan(300);
      expect(effect()).toHaveBeenCalledTimes(1);
    });
  }
});

describe("the health import preview route", () => {
  const preview = () => healthImportPreview(json("/api/staff/health-import/preview", "POST"));

  it("lets an active Clubs Administrator and a system administrator preview", async () => {
    for (const role of ["clubsAdmin", "systemAdmin"] as const) {
      signInAs(role);
      expect((await preview()).status).toBe(200);
    }
    expect(mocks.previewHealthImport).toHaveBeenCalledTimes(2);
    expect(mocks.previewHealthImport.mock.calls[0]![0]).toMatchObject({ userId: "u-clubs", viaClubsAdministrator: true });
  });

  it("refuses a revoked grant and plain staff before the upload is read", async () => {
    for (const role of ["revokedClubsAdmin", "plainStaff"] as const) {
      signInAs(role);
      expect((await preview()).status).toBe(403);
    }
    expect(mocks.readHealthImportUpload).not.toHaveBeenCalled();
    expect(mocks.previewHealthImport).not.toHaveBeenCalled();
  });
});

describe("a Clubs Administrator acting as a club's Director on a health read", () => {
  const actingAccess = (viaClubsAdministrator: boolean) => ({
    state: "OPEN",
    club: { organizationId: "club-1", name: "Test Pathfinders", role: "DIRECTOR", sponsoringChurch: null },
    actor: { kind: "STAFF_ACTING", userId: "u-clubs", staffSessionId: "s-1", actAsId: "act-1", organizationId: "club-1", ...(viaClubsAdministrator ? { viaClubsAdministrator: true } : {}) },
  });

  it("carries actorRole CLUBS_ADMINISTRATOR in the audit actor, and a system administrator's does not", async () => {
    mocks.requireRosterAccess.mockResolvedValue(actingAccess(true));
    const viewer = await requireHealthViewerForClub("club-1");
    expect(viewer).toMatchObject({ kind: "SYSTEM_ADMIN", userId: "u-clubs", actAsId: "act-1", viaClubsAdministrator: true });
    expect(healthAuditActor(viewer)).toEqual({ actorUserId: "u-clubs", metadata: { viewerKind: "SYSTEM_ADMIN", actAsId: "act-1", actorRole: "CLUBS_ADMINISTRATOR" } });

    mocks.requireRosterAccess.mockResolvedValue(actingAccess(false));
    const admin = await requireHealthViewerForClub("club-1");
    expect(healthAuditActor(admin).metadata).not.toHaveProperty("actorRole");
  });
});
