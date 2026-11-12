import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who can use Master Guide tracking (#1698): the club's director and deputy, a registrar, a reporter, another club's director,
 * an Area Coordinator and staff with and without an act-as, through the real club access check (only the sign-in, directory
 * and repository lookups are mocked), for the club routes, the page and the coordinator's approval. Synthetic data only.
 */

const mocks = vi.hoisted(() => ({
  currentStaffActingContext: vi.fn(),
  getCurrentAttendee: vi.fn(),
  listDirectedClubs: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  passkeysConfigured: vi.fn(),
  currentAreaCoordinator: vi.fn(),
  prisma: {
    attendeeMfaEnrollment: { findUnique: vi.fn() },
    attendeePasskey: { count: vi.fn() },
    attendeeSession: { findUnique: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
  addCandidate: vi.fn(),
  updateCandidate: vi.fn(),
  removeCandidate: vi.fn(),
  approveForClub: vi.fn(),
  approveForArea: vi.fn(),
  loadMasterGuide: vi.fn(),
  listAreaApprovalQueue: vi.fn(),
  coordinatorMinistriesForAccount: vi.fn(),
  rateLimit: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: mocks.listDirectedClubs }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("@/modules/attendee-accounts/passkeys", () => ({ passkeysConfigured: mocks.passkeysConfigured }));
vi.mock("@/modules/attendee-accounts/return-redirect", () => ({ twoStepRedirectPath: vi.fn(async () => "/account/two-step") }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/organizations/area-coordinators", () => ({ currentAreaCoordinator: mocks.currentAreaCoordinator, coordinatorMinistriesForAccount: mocks.coordinatorMinistriesForAccount }));
vi.mock("@/modules/rate-limit/service", () => ({ checkMasterGuideWriteRateLimit: mocks.rateLimit }));
vi.mock("@/modules/master-guide/repository", () => ({
  addCandidate: mocks.addCandidate,
  updateCandidate: mocks.updateCandidate,
  removeCandidate: mocks.removeCandidate,
  approveForClub: mocks.approveForClub,
  approveForArea: mocks.approveForArea,
  loadMasterGuide: mocks.loadMasterGuide,
  listAreaApprovalQueue: mocks.listAreaApprovalQueue,
}));
vi.mock("@/modules/club-rosters/home-view", () => ({ yearLabel: (year: string) => year }));

import ClubMasterGuidePage from "@/app/(public)/account/(portal)/clubs/[organizationId]/master-guide/page";
import MasterGuideApprovalsPage from "@/app/(public)/account/(portal)/area-clubs/master-guide/page";
import { POST as areaApprove } from "@/app/api/attendee/area-clubs/master-guide/approve/route";
import { POST as addRoute } from "@/app/api/attendee/clubs/[organizationId]/master-guide/route";
import { DELETE as removeRoute, PATCH as patchRoute } from "@/app/api/attendee/clubs/[organizationId]/master-guide/[candidateId]/route";
import { POST as approveRoute } from "@/app/api/attendee/clubs/[organizationId]/master-guide/[candidateId]/approve/route";
import { MasterGuideError } from "@/modules/master-guide/domain";

type Role = "DIRECTOR" | "DEPUTY" | "REGISTRAR" | "REPORTER";
const origin = "https://events.imsda.test";
const clubParams = { params: Promise.resolve({ organizationId: "club-1" }) };
const candidateParams = { params: Promise.resolve({ organizationId: "club-1", candidateId: "cand-1" }) };
const json = (method: string, body?: unknown) => new Request(`${origin}/api/test`, {
  method,
  headers: { origin, "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const addBody = { personId: "person-1", startedOn: "2026-01-05", mentorName: "Sam Sample" };

function signedInAs(role: Role | null, clubId = "club-1") {
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "account-1" }, via: "attendee", sessionId: "session-1" });
  mocks.listDirectedClubs.mockResolvedValue(role ? [{ organizationId: clubId, name: "Test Pathfinders", role, sponsoringChurch: null }] : []);
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.prisma.attendeeMfaEnrollment.findUnique.mockResolvedValue({ status: "ACTIVE" });
  mocks.prisma.attendeePasskey.count.mockResolvedValue(0);
  mocks.prisma.attendeeSession.findUnique.mockResolvedValue({ secondFactorVerifiedAt: new Date() });
}

const list = { clubYear: "2026-27", rows: [], eligible: [], needBirthDate: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.passkeysConfigured.mockResolvedValue(false);
  mocks.rateLimit.mockResolvedValue({ allowed: true, decisions: [] });
  mocks.addCandidate.mockResolvedValue({ id: "cand-1" });
  mocks.loadMasterGuide.mockResolvedValue(list);
  mocks.listAreaApprovalQueue.mockResolvedValue([]);
  mocks.currentAreaCoordinator.mockResolvedValue(null);
});

const clubWrites: Array<[string, (role?: unknown) => Promise<Response>, () => unknown]> = [
  ["add", () => addRoute(json("POST", addBody), clubParams), () => mocks.addCandidate],
  ["edit", () => patchRoute(json("PATCH", { startedOn: "2026-02-01" }), candidateParams), () => mocks.updateCandidate],
  ["remove", () => removeRoute(json("DELETE"), candidateParams), () => mocks.removeCandidate],
  ["approve for the club", () => approveRoute(json("POST"), candidateParams), () => mocks.approveForClub],
];

describe.each(clubWrites)("the club's %s route", (_name, call, spy) => {
  it.each(["DIRECTOR", "DEPUTY"] as const)("lets a club %s through, attributed to their own account", async (role) => {
    signedInAs(role);
    expect((await call()).status).toBeLessThan(300);
    expect(spy()).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((spy() as ReturnType<typeof vi.fn>).mock.calls[0])).toContain("account-1");
  });

  it.each(["REGISTRAR", "REPORTER"] as const)("refuses a club %s and changes nothing", async (role) => {
    signedInAs(role);
    expect((await call()).status).toBe(403);
    expect(spy()).not.toHaveBeenCalled();
  });

  it("answers 404, never revealing the club, to another club's director", async () => {
    signedInAs("DIRECTOR", "club-2");
    expect((await call()).status).toBe(404);
    expect(spy()).not.toHaveBeenCalled();
  });

  it("answers 404 to an Area Coordinator, who has no director grant in the club", async () => {
    signedInAs(null);
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "account-1" });
    expect((await call()).status).toBe(404);
    expect(spy()).not.toHaveBeenCalled();
  });

  it("answers 401 to staff with no act-as and no attendee sign-in", async () => {
    mocks.currentStaffActingContext.mockResolvedValue(null);
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect((await call()).status).toBe(401);
    expect(spy()).not.toHaveBeenCalled();
  });

  it("answers 401 to staff acting as a different club's director", async () => {
    mocks.currentStaffActingContext.mockResolvedValue({ role: "CLUB_DIRECTOR", organizationId: "club-2", userId: "staff-1", staffSessionId: "s", actAsId: "act-1" });
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect((await call()).status).toBe(401);
    expect(spy()).not.toHaveBeenCalled();
  });

  it("records staff acting as this club's director by user and act-as", async () => {
    mocks.currentStaffActingContext.mockResolvedValue({ role: "CLUB_DIRECTOR", organizationId: "club-1", userId: "staff-1", staffSessionId: "s", actAsId: "act-1" });
    mocks.prisma.organization.findUnique.mockResolvedValue({ type: "CLUB", isActive: true, name: "Test Pathfinders", parentOrganization: null });
    expect((await call()).status).toBeLessThan(300);
    expect(JSON.stringify((spy() as ReturnType<typeof vi.fn>).mock.calls[0])).toContain("\"userId\":\"staff-1\"");
  });

  it("refuses a cross-origin request before any check", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(new Response(null, { status: 403 }));
    expect((await call()).status).toBe(403);
    expect(mocks.currentStaffActingContext).not.toHaveBeenCalled();
  });

  it("answers 429 when the rate limit says stop, and changes nothing", async () => {
    signedInAs("DIRECTOR");
    mocks.rateLimit.mockResolvedValue({ allowed: false, decisions: [{ policy: "master-guide.write.actor", allowed: false, limit: 60, remaining: 0, count: 61, windowSeconds: 3600, resetAfterSeconds: 60 }] });
    expect((await call()).status).toBe(429);
    expect(spy()).not.toHaveBeenCalled();
  });

  it("answers 404 when the feature is off (the repository refuses)", async () => {
    signedInAs("DIRECTOR");
    (spy() as ReturnType<typeof vi.fn>).mockRejectedValue(new MasterGuideError("FEATURE_OFF", "Master Guide tracking is off for this club."));
    expect((await call()).status).toBe(404);
  });
});

describe("the club routes' input", () => {
  it("rejects a bad date, unknown fields (a status cannot be sent) and a non-JSON body with 400", async () => {
    signedInAs("DIRECTOR");
    expect((await addRoute(json("POST", { ...addBody, startedOn: "5 Jan" }), clubParams)).status).toBe(400);
    expect((await addRoute(json("POST", { ...addBody, status: "AREA_APPROVED" }), clubParams)).status).toBe(400);
    expect((await patchRoute(json("PATCH", { startedOn: "2026-02-01", status: "CLUB_APPROVED" }), candidateParams)).status).toBe(400);
    const notJson = new Request(`${origin}/api/test`, { method: "POST", headers: { origin }, body: "nope" });
    expect((await addRoute(notJson, clubParams)).status).toBe(400);
    expect(mocks.addCandidate).not.toHaveBeenCalled();
    expect(mocks.updateCandidate).not.toHaveBeenCalled();
  });

  it("reports the age rule's plain message with a 400", async () => {
    signedInAs("DIRECTOR");
    mocks.addCandidate.mockRejectedValue(new MasterGuideError("BIRTH_DATE_NEEDED", "Birth date needed on the roster."));
    const response = await addRoute(json("POST", addBody), clubParams);
    expect(response.status).toBe(400);
    expect((await response.json() as { message: string }).message).toBe("Birth date needed on the roster.");
  });

  it("answers 409 when the step is out of order", async () => {
    signedInAs("DIRECTOR");
    mocks.approveForClub.mockRejectedValue(new MasterGuideError("WRONG_STATUS", "Only a candidate still in progress can be approved by the club."));
    expect((await approveRoute(json("POST"), candidateParams)).status).toBe(409);
  });
});

describe("the Area Coordinator's approval route", () => {
  const call = () => areaApprove(json("POST", { candidateId: "cand-1" }));

  it("lets an Area Coordinator on their own account approve", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "account-area" });
    expect((await call()).status).toBe(200);
    expect(mocks.approveForArea).toHaveBeenCalledWith("cand-1", { accountId: "account-area" });
  });

  it.each([
    ["a club director", () => signedInAs("DIRECTOR")],
    ["staff acting as a coordinator (there is no coordinator account behind the act-as)", () => mocks.currentStaffActingContext.mockResolvedValue({ role: "AREA_COORDINATOR", userId: "staff-1", staffSessionId: "s", actAsId: "act-1" })],
    ["a signed-out visitor", () => mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null })],
  ])("answers 404 to %s and approves nothing", async (_name, arrange) => {
    arrange();
    expect((await call()).status).toBe(404);
    expect(mocks.approveForArea).not.toHaveBeenCalled();
  });

  it("answers 404 when the club has the feature off", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "account-area" });
    mocks.approveForArea.mockRejectedValue(new MasterGuideError("FEATURE_OFF", "Master Guide tracking is off for this club."));
    expect((await call()).status).toBe(404);
  });

  it("answers 409 for a candidate the club has not approved", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "account-area" });
    mocks.approveForArea.mockRejectedValue(new MasterGuideError("WRONG_STATUS", "Only a candidate the club has approved can be approved here."));
    expect((await call()).status).toBe(409);
  });

  it("takes only a candidate id: nothing else about the candidate can be sent", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "account-area" });
    expect((await areaApprove(json("POST", { candidateId: "cand-1", startedOn: "2020-01-01" }))).status).toBe(400);
    expect((await areaApprove(json("POST", {}))).status).toBe(400);
    expect(mocks.approveForArea).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request and a rate-limited one", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "account-area" });
    mocks.rateLimit.mockResolvedValue({ allowed: false, decisions: [{ policy: "master-guide.write.actor", allowed: false, limit: 60, remaining: 0, count: 61, windowSeconds: 3600, resetAfterSeconds: 60 }] });
    expect((await call()).status).toBe(429);
    mocks.rejectCrossOriginRequest.mockReturnValue(new Response(null, { status: 403 }));
    expect((await call()).status).toBe(403);
    expect(mocks.approveForArea).not.toHaveBeenCalled();
  });

  it("has no route for an Area Coordinator to add, edit or remove: the club routes refuse them", async () => {
    signedInAs(null);
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "account-1" });
    for (const [, call] of clubWrites) expect((await call()).status).toBe(404);
  });
});

describe("the club's Master Guide page", () => {
  it.each(["DIRECTOR", "DEPUTY"] as const)("shows the list to a club %s", async (role) => {
    signedInAs(role);
    expect(await ClubMasterGuidePage(clubParams)).not.toBeNull();
    expect(mocks.loadMasterGuide).toHaveBeenCalledWith("club-1");
  });

  it("is not found when the club has not switched it on", async () => {
    signedInAs("DIRECTOR");
    mocks.loadMasterGuide.mockResolvedValue(null);
    await expect(ClubMasterGuidePage(clubParams)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each(["REGISTRAR", "REPORTER"] as const)("is not found for a club %s, and loads nothing", async (role) => {
    signedInAs(role);
    await expect(ClubMasterGuidePage(clubParams)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.loadMasterGuide).not.toHaveBeenCalled();
  });

  it.each([
    ["another club's director", () => signedInAs("DIRECTOR", "club-2")],
    ["an Area Coordinator", () => signedInAs(null)],
  ])("loads nothing for %s (the club layout answers 404)", async (_name, arrange) => {
    arrange();
    expect(await ClubMasterGuidePage(clubParams)).toBeNull();
    expect(mocks.loadMasterGuide).not.toHaveBeenCalled();
  });

  it("loads nothing for staff with no act-as, and for staff acting as another club", async () => {
    mocks.currentStaffActingContext.mockResolvedValue(null);
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect(await ClubMasterGuidePage(clubParams)).toBeNull();
    mocks.currentStaffActingContext.mockResolvedValue({ role: "CLUB_DIRECTOR", organizationId: "club-2", userId: "staff-1", staffSessionId: "s", actAsId: "act-1" });
    expect(await ClubMasterGuidePage(clubParams)).toBeNull();
    expect(mocks.loadMasterGuide).not.toHaveBeenCalled();
  });

  it("shows the list to staff acting as this club's director", async () => {
    mocks.currentStaffActingContext.mockResolvedValue({ role: "CLUB_DIRECTOR", organizationId: "club-1", userId: "staff-1", staffSessionId: "s", actAsId: "act-1" });
    mocks.prisma.organization.findUnique.mockResolvedValue({ type: "CLUB", isActive: true, name: "Test Pathfinders", parentOrganization: null });
    expect(await ClubMasterGuidePage(clubParams)).not.toBeNull();
  });
});

describe("the Area Coordinator's approvals page", () => {
  it("shows the queue to an Area Coordinator, for their own ministries", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "account-area" });
    mocks.coordinatorMinistriesForAccount.mockResolvedValue(["ADVENTURER"]);
    expect(await MasterGuideApprovalsPage()).not.toBeNull();
    expect(mocks.coordinatorMinistriesForAccount).toHaveBeenCalledWith("account-area");
    expect(mocks.listAreaApprovalQueue).toHaveBeenCalledWith(["ADVENTURER"]);
  });

  it.each([
    ["a club director", () => signedInAs("DIRECTOR")],
    ["staff acting as a coordinator", () => mocks.currentStaffActingContext.mockResolvedValue({ role: "AREA_COORDINATOR", userId: "staff-1", staffSessionId: "s", actAsId: "act-1" })],
  ])("is not found for %s, and reads nothing", async (_name, arrange) => {
    arrange();
    await expect(MasterGuideApprovalsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.listAreaApprovalQueue).not.toHaveBeenCalled();
  });
});
