import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who can switch on and see roster health flags (#1709): director, deputy, another club's director, an Area Coordinator
 * and staff, through the real club access check (only the sign-in and directory lookups are mocked). Synthetic data only.
 */

const mocks = vi.hoisted(() => ({
  currentStaffActingContext: vi.fn(),
  getCurrentAttendee: vi.fn(),
  listDirectedClubs: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  passkeysConfigured: vi.fn(),
  prisma: {
    attendeeMfaEnrollment: { findUnique: vi.fn() },
    attendeePasskey: { count: vi.fn() },
    attendeeSession: { findUnique: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
  loadRosterHealth: vi.fn(),
  isClubFeatureEnabled: vi.fn(),
  setClubFeature: vi.fn(),
  listEnabledClubFeatures: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: mocks.listDirectedClubs }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("@/modules/attendee-accounts/passkeys", () => ({ passkeysConfigured: mocks.passkeysConfigured }));
vi.mock("@/modules/attendee-accounts/return-redirect", () => ({ twoStepRedirectPath: vi.fn(async () => "/account/two-step") }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/club-features/roster-health", async () => {
  const actual = await vi.importActual<typeof import("@/modules/club-features/roster-health")>("@/modules/club-features/roster-health");
  return { ...actual, loadRosterHealth: mocks.loadRosterHealth };
});
vi.mock("@/modules/club-features/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/club-features/repository")>("@/modules/club-features/repository");
  return { ...actual, isClubFeatureEnabled: mocks.isClubFeatureEnabled, setClubFeature: mocks.setClubFeature, listEnabledClubFeatures: mocks.listEnabledClubFeatures };
});
vi.mock("@/modules/club-rosters/home-view", () => ({ yearLabel: (year: string) => year }));

import RosterHealthPage, { metadata } from "@/app/(public)/account/(portal)/clubs/[organizationId]/roster-health/page";
import { PUT } from "@/app/api/attendee/clubs/[organizationId]/features/route";

type Role = "DIRECTOR" | "DEPUTY" | "REGISTRAR" | "REPORTER";
const params = { params: Promise.resolve({ organizationId: "club-1" }) };
const put = (body: unknown) => new Request("https://events.imsda.test/api/attendee/clubs/club-1/features", {
  method: "PUT",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});
const list = { clubYear: "2026-27", counts: { people: 0, flagged: 0, byFlag: {} }, rows: [], notChecked: [] };

/** Signs in an attendee with this role in club-1 (or none), a finished second step, and an authenticator. */
function signedInAs(role: Role | null, clubId = "club-1") {
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "account-1" }, via: "attendee", sessionId: "session-1" });
  mocks.listDirectedClubs.mockResolvedValue(role ? [{ organizationId: clubId, name: "Test Pathfinders", role, sponsoringChurch: null }] : []);
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.prisma.attendeeMfaEnrollment.findUnique.mockResolvedValue({ status: "ACTIVE" });
  mocks.prisma.attendeePasskey.count.mockResolvedValue(0);
  mocks.prisma.attendeeSession.findUnique.mockResolvedValue({ secondFactorVerifiedAt: new Date() });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.passkeysConfigured.mockResolvedValue(false);
  mocks.loadRosterHealth.mockResolvedValue(list);
  mocks.listEnabledClubFeatures.mockResolvedValue([]);
  mocks.setClubFeature.mockResolvedValue(true);
});

describe("switching roster health flags on (PUT club features)", () => {
  it.each(["DIRECTOR", "DEPUTY"] as const)("lets a club %s switch it, attributed to their own account", async (role) => {
    signedInAs(role);
    const response = await PUT(put({ features: { "roster-health-flags": true } }), params);
    expect(response.status).toBe(200);
    expect(mocks.setClubFeature).toHaveBeenCalledWith("club-1", "roster-health-flags", true, { accountId: "account-1" });
  });

  it("switches it off the same way", async () => {
    signedInAs("DIRECTOR");
    expect((await PUT(put({ features: { "roster-health-flags": false } }), params)).status).toBe(200);
    expect(mocks.setClubFeature).toHaveBeenCalledWith("club-1", "roster-health-flags", false, { accountId: "account-1" });
  });

  it.each(["REGISTRAR", "REPORTER"] as const)("refuses a club %s with 403 and changes nothing", async (role) => {
    signedInAs(role);
    expect((await PUT(put({ features: { "roster-health-flags": true } }), params)).status).toBe(403);
    expect(mocks.setClubFeature).not.toHaveBeenCalled();
  });

  it("answers 404, never revealing the club, to another club's director", async () => {
    signedInAs("DIRECTOR", "club-2");
    expect((await PUT(put({ features: { "roster-health-flags": true } }), params)).status).toBe(404);
    expect(mocks.setClubFeature).not.toHaveBeenCalled();
  });

  it("answers 404 to an Area Coordinator, who has no director grant in the club", async () => {
    signedInAs(null);
    expect((await PUT(put({ features: { "roster-health-flags": true } }), params)).status).toBe(404);
    expect(mocks.setClubFeature).not.toHaveBeenCalled();
  });

  it("answers 401 to staff with no act-as and no attendee sign-in", async () => {
    mocks.currentStaffActingContext.mockResolvedValue(null);
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect((await PUT(put({ features: { "roster-health-flags": true } }), params)).status).toBe(401);
    expect(mocks.setClubFeature).not.toHaveBeenCalled();
  });

  it("answers 401 to staff acting as a different club's director, whose act-as does not reach this club", async () => {
    mocks.currentStaffActingContext.mockResolvedValue({ role: "CLUB_DIRECTOR", organizationId: "club-2", userId: "staff-1", staffSessionId: "s", actAsId: "act-1" });
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect((await PUT(put({ features: { "roster-health-flags": true } }), params)).status).toBe(401);
    expect(mocks.setClubFeature).not.toHaveBeenCalled();
  });

  it("records staff acting as this club's director by user and act-as", async () => {
    mocks.currentStaffActingContext.mockResolvedValue({ role: "CLUB_DIRECTOR", organizationId: "club-1", userId: "staff-1", staffSessionId: "s", actAsId: "act-1" });
    mocks.prisma.organization.findUnique.mockResolvedValue({ type: "CLUB", isActive: true, name: "Test Pathfinders", parentOrganization: null });
    expect((await PUT(put({ features: { "roster-health-flags": true } }), params)).status).toBe(200);
    expect(mocks.setClubFeature).toHaveBeenCalledWith("club-1", "roster-health-flags", true, { userId: "staff-1", actAsId: "act-1" });
  });

  it("rejects a key that is not on the typed list, and a body that is not an object of booleans", async () => {
    signedInAs("DIRECTOR");
    expect((await PUT(put({ features: { "something-else": true } }), params)).status).toBe(400);
    expect((await PUT(put({ features: { "roster-health-flags": "yes" } }), params)).status).toBe(400);
    expect((await PUT(put({}), params)).status).toBe(400);
    expect(mocks.setClubFeature).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request before any check", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(new Response(null, { status: 403 }));
    expect((await PUT(put({ features: { "roster-health-flags": true } }), params)).status).toBe(403);
    expect(mocks.currentStaffActingContext).not.toHaveBeenCalled();
  });
});

function flat(node: ReactNode, found: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(node)) { for (const child of node) flat(child, found); return found; }
  if (!isValidElement<Record<string, unknown>>(node)) return found;
  found.push(node);
  flat(node.props.children as ReactNode, found);
  return found;
}

describe("the roster health page", () => {
  it("is named Roster health", () => {
    expect(metadata.title).toBe("Roster health");
  });

  it.each(["DIRECTOR", "DEPUTY"] as const)("shows the list to a club %s", async (role) => {
    signedInAs(role);
    const page = await RosterHealthPage(params);
    expect(page).not.toBeNull();
    expect(mocks.loadRosterHealth).toHaveBeenCalledTimes(1);
    expect(mocks.loadRosterHealth.mock.calls[0]![0]).toBe("club-1");
    expect(flat(page as ReactNode).length).toBeGreaterThan(3);
  });

  it("is not found when the club has not switched it on (the loader returns nothing)", async () => {
    signedInAs("DIRECTOR");
    mocks.loadRosterHealth.mockResolvedValue(null);
    await expect(RosterHealthPage(params)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("is not found for a registrar, who gets no list even with the feature on", async () => {
    signedInAs("REGISTRAR");
    mocks.loadRosterHealth.mockImplementation(async (_id: string, capabilities: { editProfile: boolean }) => (capabilities.editProfile ? list : null));
    await expect(RosterHealthPage(params)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each([
    ["another club's director", () => signedInAs("DIRECTOR", "club-2")],
    ["an Area Coordinator", () => signedInAs(null)],
  ])("loads nothing for %s (the club layout answers 404)", async (_name, arrange) => {
    arrange();
    expect(await RosterHealthPage(params)).toBeNull();
    expect(mocks.loadRosterHealth).not.toHaveBeenCalled();
  });

  it("loads nothing for staff with no act-as and no attendee sign-in", async () => {
    mocks.currentStaffActingContext.mockResolvedValue(null);
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect(await RosterHealthPage(params)).toBeNull();
    expect(mocks.loadRosterHealth).not.toHaveBeenCalled();
  });
});
