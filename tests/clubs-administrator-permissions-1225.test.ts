import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1225: who may do what, per role: a system administrator, a Clubs Administrator, an Event Admin of an event, a
 * Clubs Administrator whose grant was revoked, and plain staff. The real gates run (`requireClubsAdministration`,
 * `requireSystemAdministrator`, `requireStaffHealthViewer`, `requireStaffViewer`, `requirePermission`); only the
 * session, the Clubs Administrator grant lookup and the data behind each route are faked. The admin role switcher's
 * cookie is never part of any decision, so nothing here sets it. Synthetic data only.
 */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  grantFindFirst: vi.fn(),
  membershipFindMany: vi.fn(),
  findActiveMembership: vi.fn(),
  setRegistrationOnTime: vi.fn(),
  listClubReportsForYear: vi.fn(),
  revealRosterBirthDates: vi.fn(),
  getPlatformSettings: vi.fn(),
  listBackgroundCheckReviews: vi.fn(),
  getEventSettings: vi.fn(),
  resetStaffTwoStep: vi.fn(),
  setClubFormTemplateEnabled: vi.fn(),
}));

vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    clubsAdministratorGrant: { findFirst: mocks.grantFindFirst },
    eventMembership: { findMany: mocks.membershipFindMany },
  }),
}));
vi.mock("@/modules/events/repository", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  findActiveMembership: mocks.findActiveMembership,
  getEventSettings: mocks.getEventSettings,
}));
vi.mock("@/modules/club-reports/repository", () => ({
  ClubReportError: class ClubReportError extends Error { constructor(public readonly code: string, message: string) { super(message); } },
  setRegistrationOnTime: mocks.setRegistrationOnTime,
  listClubReportsForYear: mocks.listClubReportsForYear,
  saveClubReport: vi.fn(),
}));
vi.mock("@/modules/club-rosters/access", () => ({
  RosterAccessError: class RosterAccessError extends Error { constructor(public readonly code: string, public readonly status: number, message: string) { super(message); } },
  requireRosterAccess: vi.fn(),
}));
vi.mock("@/modules/club-rosters/repository", () => ({ revealRosterBirthDates: mocks.revealRosterBirthDates }));
vi.mock("@/modules/system-admin/platform-settings", () => ({
  getPlatformSettings: mocks.getPlatformSettings,
  updatePlatformSettings: vi.fn(),
  platformSettingsInputSchema: { parse: (value: unknown) => value },
  PlatformSettingsError: class PlatformSettingsError extends Error {},
}));
vi.mock("@/modules/background-checks/repository", () => ({ listBackgroundCheckReviews: mocks.listBackgroundCheckReviews, rematchBackgroundCheckList: vi.fn(async () => undefined) }));
vi.mock("@/modules/system-admin/user-admin", () => ({
  resetStaffTwoStep: mocks.resetStaffTwoStep,
  sendStaffPasswordReset: vi.fn(),
  changeStaffEmail: vi.fn(),
}));
vi.mock("@/modules/system-admin/team-directory", () => ({ getTeamDirectory: vi.fn(async () => ({ members: [] })) }));
vi.mock("@/modules/club-forms/templates", () => ({ setClubFormTemplateEnabled: mocks.setClubFormTemplateEnabled }));
vi.mock("@/modules/health-records/flag", () => ({ requireHealthRecordsEnabled: () => undefined, healthRecordsEnabled: () => true }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: vi.fn() }));
vi.mock("@/modules/attendee-accounts/passkeys", () => ({ passkeysConfigured: () => false }));
vi.mock("@/modules/organizations/area-coordinators", () => ({ currentAreaCoordinator: vi.fn() }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: vi.fn() }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: vi.fn() }));

import { PATCH as standing } from "@/app/api/admin/club-reports/standing/route";
import { GET as exportReports } from "@/app/api/admin/club-reports/export/route";
import { POST as revealBirthDates } from "@/app/api/admin/organizations/[organizationId]/roster/birth-dates/route";
import { PATCH as toggleClubForm } from "@/app/api/admin/club-forms/[templateKey]/route";
import { GET as platformSettings } from "@/app/api/admin/platform-settings/route";
import { POST as accountActions } from "@/app/api/admin/users/[userId]/actions/route";
import { GET as backgroundReviews } from "@/app/api/admin/background-checks/reviews/route";
import { POST as rematch } from "@/app/api/admin/background-checks/rematch/route";
import { GET as eventSettings } from "@/app/api/events/[eventId]/route";
import { requireStaffHealthViewer } from "@/modules/health-records/access";
import { healthAuditActor } from "@/modules/health-records/domain";
import { requireHealthImporter } from "@/modules/health-records/import-access";
import { requireSnapshotAdminViewer } from "@/modules/health-records/snapshot-access-repository";
import { resolveStaffGuardianViewer } from "@/modules/club-rosters/guardians-access";
import { requireStaffViewer, resolveStaffViewer } from "@/modules/club-forms/access";
import { viewerCanRevealBirthDates, viewerCanRevealSensitive } from "@/modules/club-forms/domain";

type Role = "systemAdmin" | "clubsAdmin" | "eventAdmin" | "revokedClubsAdmin" | "plainStaff";
const roles: Record<Role, { id: string; globalRole: "SYSTEM_ADMIN" | null }> = {
  systemAdmin: { id: "u-sys", globalRole: "SYSTEM_ADMIN" },
  clubsAdmin: { id: "u-clubs", globalRole: null },
  eventAdmin: { id: "u-event", globalRole: null },
  revokedClubsAdmin: { id: "u-revoked", globalRole: null },
  plainStaff: { id: "u-plain", globalRole: null },
};

/** Signs in as a role. The grant lookup answers for the active grant only; a revoked one is simply not found, as in the database query. */
function signInAs(role: Role) {
  const user = { ...roles[role], email: `${role}@imsda-events.test`, displayName: role };
  mocks.getCurrentSession.mockResolvedValue({ user });
  mocks.grantFindFirst.mockImplementation(async ({ where }: { where: { userId: string; revokedAt: null } }) => (
    role === "clubsAdmin" && where.userId === user.id && where.revokedAt === null ? { id: "grant-1" } : null
  ));
  // An Event Admin of a current event (for the club forms staff rule); nobody else holds a membership.
  mocks.membershipFindMany.mockImplementation(async ({ where }: { where: { permissions?: unknown } }) => (
    role === "eventAdmin" && !where.permissions
      ? [{ role: "EVENT_ADMIN", event: { timezone: "America/Chicago", endsAt: new Date("2099-01-01T00:00:00Z") } }]
      : []
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
  mocks.setRegistrationOnTime.mockResolvedValue(undefined);
  mocks.listClubReportsForYear.mockResolvedValue([]);
  mocks.revealRosterBirthDates.mockResolvedValue([]);
  mocks.setClubFormTemplateEnabled.mockResolvedValue({ key: "synthetic_form", enabled: true });
  mocks.getPlatformSettings.mockResolvedValue({});
  mocks.listBackgroundCheckReviews.mockResolvedValue([]);
  mocks.findActiveMembership.mockResolvedValue(null);
  mocks.getEventSettings.mockResolvedValue({ id: "evt-a" });
  mocks.resetStaffTwoStep.mockResolvedValue(undefined);
});

const clubAreaCalls: Array<{ name: string; call: () => Promise<Response>; effect: () => ReturnType<typeof vi.fn> }> = [
  { name: "club points standing", call: () => standing(json("/api/admin/club-reports/standing", "PATCH", { organizationId: "club-1", clubYear: "2026-27", registrationOnTime: true })), effect: () => mocks.setRegistrationOnTime },
  { name: "club reports CSV export", call: () => exportReports(json("/api/admin/club-reports/export?year=2026-27", "GET")), effect: () => mocks.listClubReportsForYear },
  { name: "roster birth-date reveal", call: () => revealBirthDates(json("/api/admin/organizations/club-1/roster/birth-dates", "POST"), ctx({ organizationId: "club-1" })), effect: () => mocks.revealRosterBirthDates },
  { name: "turning a club form on", call: () => toggleClubForm(json("/api/admin/club-forms/synthetic_form", "PATCH", { enabled: true }), ctx({ templateKey: "synthetic_form" })), effect: () => mocks.setClubFormTemplateEnabled },
];

describe("the club areas: system administrators and Clubs Administrators", () => {
  for (const area of clubAreaCalls) {
    for (const role of ["systemAdmin", "clubsAdmin"] as const) {
      it(`${area.name}: lets ${role} in`, async () => {
        signInAs(role);
        const response = await area.call();
        expect(response.status).toBeLessThan(300);
        expect(area.effect()).toHaveBeenCalledTimes(1);
      });
    }
    for (const role of ["eventAdmin", "revokedClubsAdmin", "plainStaff"] as const) {
      it(`${area.name}: refuses ${role} with a 403 and does nothing`, async () => {
        signInAs(role);
        const response = await area.call();
        expect(response.status).toBe(403);
        expect(area.effect()).not.toHaveBeenCalled();
      });
    }
    it(`${area.name}: asks for sign-in (401) when signed out`, async () => {
      mocks.getCurrentSession.mockResolvedValue({ user: null });
      expect((await area.call()).status).toBe(401);
      expect(area.effect()).not.toHaveBeenCalled();
    });
  }

  it("records who revealed birth dates, whether a system administrator or a Clubs Administrator", async () => {
    signInAs("clubsAdmin");
    await revealBirthDates(json("/api/admin/organizations/club-1/roster/birth-dates", "POST"), ctx({ organizationId: "club-1" }));
    expect(mocks.revealRosterBirthDates).toHaveBeenCalledWith("club-1", expect.any(String), { userId: "u-clubs" });
    signInAs("systemAdmin");
    await revealBirthDates(json("/api/admin/organizations/club-1/roster/birth-dates", "POST"), ctx({ organizationId: "club-1" }));
    expect(mocks.revealRosterBirthDates).toHaveBeenLastCalledWith("club-1", expect.any(String), { userId: "u-sys" });
  });

  it("takes effect on the next request: a revoke is read from the database each time", async () => {
    signInAs("clubsAdmin");
    expect((await clubAreaCalls[1]!.call()).status).toBe(200);
    signInAs("revokedClubsAdmin");
    expect((await clubAreaCalls[1]!.call()).status).toBe(403);
    expect(mocks.grantFindFirst.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("club forms staff viewer and birth dates", () => {
  it("makes a Clubs Administrator staff who reads birth dates; an Event Admin is staff without them; nobody else is staff", async () => {
    signInAs("clubsAdmin");
    const clubs = await resolveStaffViewer();
    expect(clubs).toMatchObject({ kind: "STAFF", clubsAdministrator: true, systemAdmin: false });
    expect(viewerCanRevealBirthDates(clubs!, "club-1")).toBe(true);

    signInAs("systemAdmin");
    expect(viewerCanRevealBirthDates((await resolveStaffViewer())!, "club-1")).toBe(true);

    signInAs("eventAdmin");
    const eventAdmin = await resolveStaffViewer();
    expect(eventAdmin).toMatchObject({ kind: "STAFF", clubsAdministrator: false, systemAdmin: false });
    expect(viewerCanRevealBirthDates(eventAdmin!, "club-1")).toBe(false);
    expect(viewerCanRevealSensitive(eventAdmin!, "club-1")).toBe(true);

    for (const role of ["revokedClubsAdmin", "plainStaff"] as const) {
      signInAs(role);
      expect(await resolveStaffViewer()).toBeNull();
      await expect(requireStaffViewer()).rejects.toMatchObject({ status: 403 });
    }
  });
});

describe("what a Clubs Administrator sees like a system administrator, and what it can never reach", () => {
  it("opens health records like a system administrator (view only, same checks), marked as Clubs Administrator in the audit actor, and refuses a revoked grant", async () => {
    signInAs("clubsAdmin");
    const viewer = await requireStaffHealthViewer();
    expect(viewer).toMatchObject({ kind: "SYSTEM_ADMIN", userId: "u-clubs", viaClubsAdministrator: true });
    expect(healthAuditActor(viewer)).toEqual({ actorUserId: "u-clubs", metadata: { viewerKind: "SYSTEM_ADMIN", actorRole: "CLUBS_ADMINISTRATOR" } });
    signInAs("systemAdmin");
    const admin = await requireStaffHealthViewer();
    expect(admin).toEqual({ kind: "SYSTEM_ADMIN", userId: "u-sys" });
    expect(healthAuditActor(admin).metadata).not.toHaveProperty("actorRole");
    for (const role of ["revokedClubsAdmin", "eventAdmin", "plainStaff"] as const) {
      signInAs(role);
      await expect(requireStaffHealthViewer()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("lets a Clubs Administrator run the health record import like a system administrator (#1232), but never while acting as a director", () => {
    expect(requireHealthImporter({ kind: "SYSTEM_ADMIN", userId: "u-clubs", viaClubsAdministrator: true })).toMatchObject({ userId: "u-clubs" });
    expect(requireHealthImporter({ kind: "SYSTEM_ADMIN", userId: "u-sys" })).toMatchObject({ userId: "u-sys" });
    expect(() => requireHealthImporter({ kind: "SYSTEM_ADMIN", userId: "u-clubs", actAsId: "act-1", viaClubsAdministrator: true })).toThrow(/Clubs Administrator/);
  });

  it("opens sealed copies and break-glass to a Clubs Administrator but not the holds, and refuses a revoked grant", async () => {
    signInAs("clubsAdmin");
    for (const attempted of ["VIEW_SEALED_COPIES", "BREAK_GLASS_START", "LIST_BREAK_GLASS"]) {
      await expect(requireSnapshotAdminViewer(attempted, null, { allowClubsAdministrator: true })).resolves.toMatchObject({ kind: "SYSTEM_ADMIN", viaClubsAdministrator: true });
    }
    // Without the route's opt-in (the hold routes), a Clubs Administrator is refused.
    await expect(requireSnapshotAdminViewer("PLACE_HOLD", null, { flagOptional: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    signInAs("revokedClubsAdmin");
    await expect(requireSnapshotAdminViewer("BREAK_GLASS_START", null, { allowClubsAdministrator: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    signInAs("systemAdmin");
    await expect(requireSnapshotAdminViewer("PLACE_HOLD", null, { flagOptional: true })).resolves.toMatchObject({ kind: "SYSTEM_ADMIN" });
  });

  it("gives a Clubs Administrator guardian contacts like a system administrator, and a revoked one nothing", async () => {
    signInAs("clubsAdmin");
    expect(await resolveStaffGuardianViewer()).toEqual({ kind: "STAFF", userId: "u-clubs" });
    signInAs("revokedClubsAdmin");
    expect(await resolveStaffGuardianViewer()).toBeNull();
  });

  it("refuses system settings", async () => {
    signInAs("clubsAdmin");
    expect((await platformSettings(json("/api/admin/platform-settings", "GET"))).status).toBe(403);
    expect(mocks.getPlatformSettings).not.toHaveBeenCalled();
    signInAs("systemAdmin");
    expect((await platformSettings(json("/api/admin/platform-settings", "GET"))).status).toBe(200);
  });

  it("refuses accounts: resetting someone's two-step sign-in", async () => {
    const call = () => accountActions(json("/api/admin/users/u-x/actions", "POST", { action: "reset-two-step" }), ctx({ userId: "u-x" }));
    signInAs("clubsAdmin");
    expect((await call()).status).toBe(403);
    expect(mocks.resetStaffTwoStep).not.toHaveBeenCalled();
    signInAs("systemAdmin");
    expect((await call()).status).toBe(200);
  });

  it("opens Sterling Volunteers read routes to a Clubs Administrator, not to a revoked one, and the review writes too (#1232)", async () => {
    signInAs("clubsAdmin");
    expect((await backgroundReviews(json("/api/admin/background-checks/reviews", "GET"))).status).toBe(200);
    expect(mocks.listBackgroundCheckReviews).toHaveBeenCalledTimes(1);
    signInAs("revokedClubsAdmin");
    expect((await backgroundReviews(json("/api/admin/background-checks/reviews", "GET"))).status).toBe(403);
    expect(mocks.listBackgroundCheckReviews).toHaveBeenCalledTimes(1);
    signInAs("clubsAdmin");
    expect((await rematch(json("/api/admin/background-checks/rematch", "POST"))).status).toBe(200);
    signInAs("revokedClubsAdmin");
    expect((await rematch(json("/api/admin/background-checks/rematch", "POST"))).status).toBe(403);
  });

  it("refuses another event's data: a Clubs Administrator or an Event Admin of a different event is not assigned to it", async () => {
    // Event A's membership exists for the Event Admin only; the route asks for event B.
    mocks.findActiveMembership.mockImplementation(async (userId: string, eventId: string) => (
      userId === roles.eventAdmin.id && eventId === "evt-a"
        ? { eventId, userId, role: "EVENT_ADMIN", status: "ACTIVE", permissions: [] }
        : null
    ));
    for (const role of ["clubsAdmin", "eventAdmin"] as const) {
      signInAs(role);
      const response = await eventSettings(json("/api/events/evt-b", "GET"), ctx({ eventId: "evt-b" }));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: "EVENT_ACCESS_DENIED" });
    }
    expect(mocks.getEventSettings).not.toHaveBeenCalled();
    signInAs("eventAdmin");
    expect((await eventSettings(json("/api/events/evt-a", "GET"), ctx({ eventId: "evt-a" }))).status).toBe(200);
  });
});
