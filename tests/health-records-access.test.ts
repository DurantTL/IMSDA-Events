import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  enabled: true,
  roster: vi.fn(),
  session: vi.fn(),
  acting: vi.fn(),
  memberships: vi.fn(),
  coordinator: vi.fn(),
  attendee: vi.fn(),
  sessionFind: vi.fn(),
  directed: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ HEALTH_RECORDS_ENABLED: state.enabled }) }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ clubsAdministratorGrant: { findFirst: async () => null }, eventMembership: { findMany: state.memberships }, attendeeSession: { findUnique: state.sessionFind } }) }));
vi.mock("@/modules/club-rosters/access", () => ({ requireRosterAccess: state.roster, ROSTER_UNLOCK_HOURS: 12 }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: state.attendee }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: state.session }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: state.acting }));
vi.mock("@/modules/organizations/area-coordinators", () => ({ currentAreaCoordinator: state.coordinator }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: state.directed }));

import {
  requireAreaCoordinatorHealthViewer,
  requireHealthViewerForClub,
  requireStaffHealthViewer,
  resolveAcknowledgmentViewer,
} from "@/modules/health-records/access";

function rosterAs(role: string, actor: Record<string, unknown> = { kind: "ATTENDEE", accountId: "acct-1" }) {
  return { club: { organizationId: "club-a", role }, actor };
}

describe("health access: club portal", () => {
  beforeEach(() => {
    state.enabled = true;
    state.roster.mockReset();
    state.session.mockReset();
    state.acting.mockReset();
    state.memberships.mockReset();
    state.memberships.mockResolvedValue([]);
    state.acting.mockResolvedValue(null);
  });

  it("lets a club director and a deputy in as club leaders for their own club", async () => {
    for (const role of ["DIRECTOR", "DEPUTY"]) {
      state.roster.mockResolvedValue(rosterAs(role));
      await expect(requireHealthViewerForClub("club-a")).resolves.toEqual({ kind: "CLUB_LEADER", organizationId: "club-a", accountId: "acct-1" });
    }
  });

  it("lets a registrar in as a write-only registrar for their own club, and refuses a reporter (#923)", async () => {
    state.roster.mockResolvedValue(rosterAs("REGISTRAR"));
    await expect(requireHealthViewerForClub("club-a")).resolves.toEqual({ kind: "CLUB_REGISTRAR", organizationId: "club-a", accountId: "acct-1" });
    state.roster.mockResolvedValue(rosterAs("REPORTER"));
    await expect(requireHealthViewerForClub("club-a")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("passes the roster gate's refusals through (another club, no second step, signed out)", async () => {
    state.roster.mockRejectedValue(Object.assign(new Error("not found"), { code: "NOT_FOUND", status: 404 }));
    await expect(requireHealthViewerForClub("club-b")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("treats a system administrator acting as the director as a view-only system administrator, never an editor", async () => {
    state.roster.mockResolvedValue(rosterAs("DIRECTOR", { kind: "STAFF_ACTING", userId: "admin-1", actAsId: "act-1" }));
    await expect(requireHealthViewerForClub("club-a")).resolves.toEqual({ kind: "SYSTEM_ADMIN", userId: "admin-1", actAsId: "act-1" });
  });

  it("is not found when the feature is off, before the roster gate is consulted", async () => {
    state.enabled = false;
    await expect(requireHealthViewerForClub("club-a")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.roster).not.toHaveBeenCalled();
  });
});

describe("health access: staff", () => {
  beforeEach(() => {
    state.enabled = true;
    state.session.mockReset();
    state.acting.mockReset();
    state.memberships.mockReset();
    state.acting.mockResolvedValue(null);
    state.memberships.mockResolvedValue([]);
  });

  it("refuses a signed-out visitor with 401", async () => {
    state.session.mockResolvedValue({ user: null });
    await expect(requireStaffHealthViewer()).rejects.toMatchObject({ status: 401 });
  });

  it("refuses Event Admins, registration, finance, check-in staff and sensitive-data holders who lack the explicit permission", async () => {
    for (const user of [
      { id: "u-eventadmin", globalRole: null },
      { id: "u-registration", globalRole: null },
      { id: "u-finance", globalRole: null },
      { id: "u-checkin", globalRole: null },
    ]) {
      state.session.mockResolvedValue({ user });
      await expect(requireStaffHealthViewer()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    // The lookup is for an ACTIVE membership that carries the permission itself.
    expect(state.memberships).toHaveBeenLastCalledWith({
      where: { userId: "u-checkin", status: "ACTIVE", permissions: { has: "VIEW_HEALTH_INFORMATION" } },
      select: { eventId: true, permissions: true },
    });
  });

  it("does not let a membership row that merely matches the query widen access", async () => {
    state.session.mockResolvedValue({ user: { id: "u-odd", globalRole: null } });
    state.memberships.mockResolvedValue([{ eventId: "event-1", permissions: ["VIEW_EVENT", "VIEW_SENSITIVE_DATA"] }]);
    await expect(requireStaffHealthViewer()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets staff holding VIEW_HEALTH_INFORMATION in, for those events only", async () => {
    state.session.mockResolvedValue({ user: { id: "u-health", globalRole: null } });
    state.memberships.mockResolvedValue([
      { eventId: "event-1", permissions: ["VIEW_EVENT", "VIEW_HEALTH_INFORMATION"] },
      { eventId: "event-2", permissions: ["VIEW_HEALTH_INFORMATION"] },
    ]);
    await expect(requireStaffHealthViewer()).resolves.toEqual({ kind: "HEALTH_ROLE", userId: "u-health", eventIds: ["event-1", "event-2"] });
  });

  it("lets a system administrator in without any membership, as a view-only system administrator", async () => {
    state.session.mockResolvedValue({ user: { id: "u-sysadmin", globalRole: "SYSTEM_ADMIN" } });
    await expect(requireStaffHealthViewer()).resolves.toEqual({ kind: "SYSTEM_ADMIN", userId: "u-sysadmin" });
    expect(state.memberships).not.toHaveBeenCalled();
  });

  it("is not found when the feature is off, before any session is read", async () => {
    state.enabled = false;
    await expect(requireStaffHealthViewer()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.session).not.toHaveBeenCalled();
  });
});

describe("health access: Area Coordinator", () => {
  const now = new Date("2026-10-05T15:00:00Z");

  beforeEach(() => {
    state.enabled = true;
    state.coordinator.mockReset();
    state.attendee.mockReset();
    state.sessionFind.mockReset();
    state.attendee.mockResolvedValue({ via: "attendee", sessionId: "session-1" });
  });

  it("admits a coordinator whose second step was verified within 12 hours", async () => {
    state.coordinator.mockResolvedValue({ id: "acct-coord" });
    state.sessionFind.mockResolvedValue({ secondFactorVerifiedAt: new Date(now.getTime() - 11 * 3_600_000) });
    await expect(requireAreaCoordinatorHealthViewer(now)).resolves.toEqual({ kind: "AREA_COORDINATOR", accountId: "acct-coord" });
  });

  it("asks a coordinator whose second step is older than 12 hours, or missing, to confirm again", async () => {
    state.coordinator.mockResolvedValue({ id: "acct-coord" });
    state.sessionFind.mockResolvedValue({ secondFactorVerifiedAt: new Date(now.getTime() - 13 * 3_600_000) });
    await expect(requireAreaCoordinatorHealthViewer(now)).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
    state.sessionFind.mockResolvedValue({ secondFactorVerifiedAt: null });
    await expect(requireAreaCoordinatorHealthViewer(now)).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
    state.attendee.mockResolvedValue({ via: "staff", sessionId: null });
    await expect(requireAreaCoordinatorHealthViewer(now)).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
  });

  it("refuses everyone else, including a coordinator without a verified MFA session, as not found", async () => {
    state.coordinator.mockResolvedValue(null);
    await expect(requireAreaCoordinatorHealthViewer(now)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is not found when the feature is off, before the coordinator is looked up", async () => {
    state.enabled = false;
    await expect(requireAreaCoordinatorHealthViewer(now)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.coordinator).not.toHaveBeenCalled();
  });
});

describe("who may acknowledge the privacy notice (#923)", () => {
  beforeEach(() => {
    state.enabled = true;
    for (const mock of [state.session, state.acting, state.memberships, state.coordinator, state.attendee, state.directed]) mock.mockReset();
    state.memberships.mockResolvedValue([]);
    state.coordinator.mockResolvedValue(null);
    state.directed.mockResolvedValue([]);
  });

  it("identifies a system administrator or the health role by user, and refuses other staff", async () => {
    state.session.mockResolvedValue({ user: { id: "u-sysadmin", globalRole: "SYSTEM_ADMIN" } });
    await expect(resolveAcknowledgmentViewer("STAFF")).resolves.toEqual({ kind: "SYSTEM_ADMIN", userId: "u-sysadmin" });
    state.session.mockResolvedValue({ user: { id: "u-health", globalRole: null } });
    state.memberships.mockResolvedValue([{ eventId: "event-1", permissions: ["VIEW_HEALTH_INFORMATION"] }]);
    await expect(resolveAcknowledgmentViewer("STAFF")).resolves.toEqual({ kind: "HEALTH_ROLE", userId: "u-health" });
    state.memberships.mockResolvedValue([]);
    await expect(resolveAcknowledgmentViewer("STAFF")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("identifies an Area Coordinator, a director or deputy, and a Registrar by attendee account", async () => {
    state.attendee.mockResolvedValue({ account: { id: "acct-1" } });
    state.coordinator.mockResolvedValue({ id: "acct-1" });
    await expect(resolveAcknowledgmentViewer("ATTENDEE")).resolves.toEqual({ kind: "AREA_COORDINATOR", accountId: "acct-1" });
    state.coordinator.mockResolvedValue(null);
    state.directed.mockResolvedValue([{ organizationId: "club-a", role: "DEPUTY" }, { organizationId: "club-b", role: "REGISTRAR" }]);
    await expect(resolveAcknowledgmentViewer("ATTENDEE")).resolves.toEqual({ kind: "CLUB_LEADER", accountId: "acct-1" });
    state.directed.mockResolvedValue([{ organizationId: "club-b", role: "REGISTRAR" }]);
    await expect(resolveAcknowledgmentViewer("ATTENDEE")).resolves.toEqual({ kind: "CLUB_REGISTRAR", accountId: "acct-1" });
  });

  it("refuses a reporter, a signed-out visitor, and everything with the feature off", async () => {
    state.attendee.mockResolvedValue({ account: { id: "acct-1" } });
    state.directed.mockResolvedValue([{ organizationId: "club-a", role: "REPORTER" }]);
    await expect(resolveAcknowledgmentViewer("ATTENDEE")).rejects.toMatchObject({ code: "FORBIDDEN" });
    state.attendee.mockResolvedValue({ account: null });
    await expect(resolveAcknowledgmentViewer("ATTENDEE")).rejects.toMatchObject({ status: 401 });
    state.enabled = false;
    await expect(resolveAcknowledgmentViewer("ATTENDEE")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(resolveAcknowledgmentViewer("STAFF")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
