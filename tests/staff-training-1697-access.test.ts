import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who can use staff training records (#1697): director, deputy, registrar, reporter, another club's director, an Area
 * Coordinator and staff (with and without an act-as), through the real club access check. Only sign-in, directory,
 * feature and repository lookups are mocked. Synthetic data only.
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
  isClubFeatureEnabled: vi.fn(),
  addStaffTrainingRecord: vi.fn(),
  removeStaffTrainingRecord: vi.fn(),
  loadStaffTraining: vi.fn(),
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
vi.mock("@/modules/rate-limit/service", () => ({ checkClubStaffTrainingRateLimit: mocks.rateLimit }));
vi.mock("@/modules/club-features/repository", () => ({ isClubFeatureEnabled: mocks.isClubFeatureEnabled }));
vi.mock("@/modules/club-rosters/home-view", () => ({ yearLabel: (year: string) => year }));
vi.mock("@/modules/staff-training/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/staff-training/repository")>("@/modules/staff-training/repository");
  return {
    ...actual,
    addStaffTrainingRecord: mocks.addStaffTrainingRecord,
    removeStaffTrainingRecord: mocks.removeStaffTrainingRecord,
    loadStaffTraining: mocks.loadStaffTraining,
  };
});

import StaffTrainingPage, { metadata } from "@/app/(public)/account/(portal)/clubs/[organizationId]/staff-training/page";
import { POST } from "@/app/api/attendee/clubs/[organizationId]/staff-training/route";
import { DELETE } from "@/app/api/attendee/clubs/[organizationId]/staff-training/[recordId]/route";

type Role = "DIRECTOR" | "DEPUTY" | "REGISTRAR" | "REPORTER";
const params = { params: Promise.resolve({ organizationId: "club-1" }) };
const recordParams = { params: Promise.resolve({ organizationId: "club-1", recordId: "record-1" }) };
const url = "https://events.imsda.test/api/attendee/clubs/club-1/staff-training";
const post = (body: unknown) => new Request(url, {
  method: "POST",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});
const del = () => new Request(`${url}/record-1`, { method: "DELETE", headers: { origin: "https://events.imsda.test" } });
const goodBody = { personId: "person-1", kind: "CERTIFICATION", certificationKey: "COUNSELOR", completedOn: "2026-01-15" };
const list = { clubYear: "2026-27", people: [] };

function signedInAs(role: Role | null, clubId = "club-1") {
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "account-1" }, via: "attendee", sessionId: "session-1" });
  mocks.listDirectedClubs.mockResolvedValue(role ? [{ organizationId: clubId, name: "Test Pathfinders", role, sponsoringChurch: null }] : []);
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.prisma.attendeeMfaEnrollment.findUnique.mockResolvedValue({ status: "ACTIVE" });
  mocks.prisma.attendeePasskey.count.mockResolvedValue(0);
  mocks.prisma.attendeeSession.findUnique.mockResolvedValue({ secondFactorVerifiedAt: new Date() });
}

function actingAsDirector(organizationId = "club-1", extra: Record<string, unknown> = {}) {
  mocks.currentStaffActingContext.mockResolvedValue({ role: "CLUB_DIRECTOR", organizationId, userId: "staff-1", staffSessionId: "s", actAsId: "act-1", ...extra });
  mocks.prisma.organization.findUnique.mockResolvedValue({ type: "CLUB", isActive: true, name: "Test Pathfinders", parentOrganization: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T12:00:00.000Z"));
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.passkeysConfigured.mockResolvedValue(false);
  mocks.isClubFeatureEnabled.mockResolvedValue(true);
  mocks.rateLimit.mockResolvedValue({ allowed: true, decisions: [] });
  mocks.addStaffTrainingRecord.mockResolvedValue({ id: "record-1" });
  mocks.removeStaffTrainingRecord.mockResolvedValue(undefined);
  mocks.loadStaffTraining.mockImplementation(async (_id: string, capabilities: { editProfile: boolean }) => (capabilities.editProfile ? list : null));
});

describe("adding a record (POST)", () => {
  it.each(["DIRECTOR", "DEPUTY"] as const)("lets a club %s add, attributed to their own account", async (role) => {
    signedInAs(role);
    const response = await POST(post(goodBody), params);
    expect(response.status).toBe(201);
    expect(mocks.addStaffTrainingRecord).toHaveBeenCalledTimes(1);
    expect(mocks.addStaffTrainingRecord.mock.calls[0]![0]).toBe("club-1");
    expect(mocks.addStaffTrainingRecord.mock.calls[0]![1]).toMatchObject({ personId: "person-1", kind: "CERTIFICATION", certificationKey: "COUNSELOR" });
    expect(mocks.addStaffTrainingRecord.mock.calls[0]![2]).toEqual({ accountId: "account-1" });
  });

  it.each(["REGISTRAR", "REPORTER"] as const)("refuses a club %s with 403 and writes nothing", async (role) => {
    signedInAs(role);
    expect((await POST(post(goodBody), params)).status).toBe(403);
    expect(mocks.addStaffTrainingRecord).not.toHaveBeenCalled();
  });

  it("answers 404 to another club's director, and to an Area Coordinator with no grant here", async () => {
    signedInAs("DIRECTOR", "club-2");
    expect((await POST(post(goodBody), params)).status).toBe(404);
    signedInAs(null);
    expect((await POST(post(goodBody), params)).status).toBe(404);
    expect(mocks.addStaffTrainingRecord).not.toHaveBeenCalled();
  });

  it("answers 401 to staff with no act-as, and to staff acting as another club's director", async () => {
    mocks.currentStaffActingContext.mockResolvedValue(null);
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect((await POST(post(goodBody), params)).status).toBe(401);
    mocks.currentStaffActingContext.mockResolvedValue({ role: "CLUB_DIRECTOR", organizationId: "club-2", userId: "staff-1", staffSessionId: "s", actAsId: "act-1" });
    expect((await POST(post(goodBody), params)).status).toBe(401);
    expect(mocks.addStaffTrainingRecord).not.toHaveBeenCalled();
  });

  it("records staff acting as this club's director by user and act-as, and a Clubs Administrator as one", async () => {
    actingAsDirector();
    expect((await POST(post(goodBody), params)).status).toBe(201);
    expect(mocks.addStaffTrainingRecord.mock.calls[0]![2]).toEqual({ userId: "staff-1", actAsId: "act-1" });
    actingAsDirector("club-1", { viaClubsAdministrator: true });
    expect((await POST(post(goodBody), params)).status).toBe(201);
    expect(mocks.addStaffTrainingRecord.mock.calls[1]![2]).toEqual({ userId: "staff-1", actAsId: "act-1", viaClubsAdministrator: true });
  });

  it("answers 404 and writes nothing while the club has not switched the feature on", async () => {
    signedInAs("DIRECTOR");
    mocks.isClubFeatureEnabled.mockResolvedValue(false);
    const response = await POST(post(goodBody), params);
    expect(response.status).toBe(404);
    expect(mocks.isClubFeatureEnabled).toHaveBeenCalledWith("club-1", "staff-training-records");
    expect(mocks.addStaffTrainingRecord).not.toHaveBeenCalled();
  });

  it("answers 404 when the repository says the person is not on this club's roster", async () => {
    signedInAs("DIRECTOR");
    const { StaffTrainingError } = await import("@/modules/staff-training/repository");
    mocks.addStaffTrainingRecord.mockRejectedValue(new StaffTrainingError("PERSON_NOT_ON_ROSTER", "That person is not an adult on this club's roster."));
    const response = await POST(post(goodBody), params);
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("PERSON_NOT_ON_ROSTER");
  });

  it.each([
    ["an unlisted certification", { ...goodBody, certificationKey: "MASTER_GUIDE" }],
    ["a future date", { ...goodBody, completedOn: "2027-03-01" }],
    ["a workshop with no title", { personId: "person-1", kind: "WORKSHOP", workshopCode: "W-1", workshopTitle: "", completedOn: "2026-01-15" }],
    ["no kind", { personId: "person-1", completedOn: "2026-01-15" }],
    ["no body", {}],
  ])("answers 400 for %s and writes nothing", async (_name, body) => {
    signedInAs("DIRECTOR");
    expect((await POST(post(body), params)).status).toBe(400);
    expect(mocks.addStaffTrainingRecord).not.toHaveBeenCalled();
  });

  it("answers 429 when rate limited, before writing", async () => {
    signedInAs("DIRECTOR");
    mocks.rateLimit.mockResolvedValue({ allowed: false, decisions: [] });
    expect((await POST(post(goodBody), params)).status).toBe(429);
    expect(mocks.addStaffTrainingRecord).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request before any check", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(new Response(null, { status: 403 }));
    expect((await POST(post(goodBody), params)).status).toBe(403);
    expect(mocks.currentStaffActingContext).not.toHaveBeenCalled();
  });
});

describe("removing a record (DELETE)", () => {
  it.each(["DIRECTOR", "DEPUTY"] as const)("lets a club %s remove one", async (role) => {
    signedInAs(role);
    expect((await DELETE(del(), recordParams)).status).toBe(200);
    expect(mocks.removeStaffTrainingRecord).toHaveBeenCalledWith("club-1", "record-1", { accountId: "account-1" });
  });

  it.each(["REGISTRAR", "REPORTER"] as const)("refuses a club %s", async (role) => {
    signedInAs(role);
    expect((await DELETE(del(), recordParams)).status).toBe(403);
    expect(mocks.removeStaffTrainingRecord).not.toHaveBeenCalled();
  });

  it("answers 404 to another club's director, an Area Coordinator, and when the feature is off", async () => {
    signedInAs("DIRECTOR", "club-2");
    expect((await DELETE(del(), recordParams)).status).toBe(404);
    signedInAs(null);
    expect((await DELETE(del(), recordParams)).status).toBe(404);
    signedInAs("DIRECTOR");
    mocks.isClubFeatureEnabled.mockResolvedValue(false);
    expect((await DELETE(del(), recordParams)).status).toBe(404);
    expect(mocks.removeStaffTrainingRecord).not.toHaveBeenCalled();
  });

  it("answers 404 for a record the club does not hold", async () => {
    signedInAs("DIRECTOR");
    const { StaffTrainingError } = await import("@/modules/staff-training/repository");
    mocks.removeStaffTrainingRecord.mockRejectedValue(new StaffTrainingError("RECORD_NOT_FOUND", "That record could not be found."));
    expect((await DELETE(del(), recordParams)).status).toBe(404);
  });

  it("works for staff acting as this club's director and refuses without an act-as", async () => {
    actingAsDirector();
    expect((await DELETE(del(), recordParams)).status).toBe(200);
    expect(mocks.removeStaffTrainingRecord).toHaveBeenCalledWith("club-1", "record-1", { userId: "staff-1", actAsId: "act-1" });
    mocks.currentStaffActingContext.mockResolvedValue(null);
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect((await DELETE(del(), recordParams)).status).toBe(401);
  });
});

function flat(node: ReactNode, found: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(node)) { for (const child of node) flat(child, found); return found; }
  if (!isValidElement<Record<string, unknown>>(node)) return found;
  found.push(node);
  flat(node.props.children as ReactNode, found);
  return found;
}

describe("the staff training page", () => {
  it("is named Staff training", () => {
    expect(metadata.title).toBe("Staff training");
  });

  it.each(["DIRECTOR", "DEPUTY"] as const)("shows the page to a club %s", async (role) => {
    signedInAs(role);
    const page = await StaffTrainingPage(params);
    expect(page).not.toBeNull();
    expect(mocks.loadStaffTraining.mock.calls[0]![0]).toBe("club-1");
    expect(flat(page as ReactNode).length).toBeGreaterThan(3);
  });

  it("shows the page to staff acting as this club's director", async () => {
    actingAsDirector();
    expect(await StaffTrainingPage(params)).not.toBeNull();
    expect(mocks.loadStaffTraining).toHaveBeenCalledTimes(1);
  });

  it("is not found when the club has not switched it on (the loader returns nothing)", async () => {
    signedInAs("DIRECTOR");
    mocks.loadStaffTraining.mockResolvedValue(null);
    await expect(StaffTrainingPage(params)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("is not found for a registrar, even with the feature on", async () => {
    signedInAs("REGISTRAR");
    await expect(StaffTrainingPage(params)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("loads nothing for a reporter, who has no roster access (the page says the role does not include it)", async () => {
    signedInAs("REPORTER");
    const page = await StaffTrainingPage(params);
    expect(mocks.loadStaffTraining).not.toHaveBeenCalled();
    expect(page).not.toBeNull();
  });

  it.each([
    ["another club's director", () => signedInAs("DIRECTOR", "club-2")],
    ["an Area Coordinator", () => signedInAs(null)],
  ])("loads nothing for %s (the club layout answers 404)", async (_name, arrange) => {
    arrange();
    expect(await StaffTrainingPage(params)).toBeNull();
    expect(mocks.loadStaffTraining).not.toHaveBeenCalled();
  });

  it("loads nothing for staff with no act-as and no attendee sign-in, or acting as another club", async () => {
    mocks.currentStaffActingContext.mockResolvedValue(null);
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect(await StaffTrainingPage(params)).toBeNull();
    actingAsDirector("club-2");
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect(await StaffTrainingPage(params)).toBeNull();
    expect(mocks.loadStaffTraining).not.toHaveBeenCalled();
  });
});
