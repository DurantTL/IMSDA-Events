import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentAreaCoordinator: vi.fn(),
  isAreaCoordinator: vi.fn(),
  requireRosterAccess: vi.fn(),
  applyTeacherSettings: vi.fn(),
  setClubTeachers: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
}));

// The guest club rule (#835) reads the club's `guestEventId`; these routes are about the conference club's own event.
vi.mock("@/modules/club-registrations/event-gate", async (importOriginal) => ({ ...(await importOriginal<object>()), rejectGuestClubOtherEvent: async () => null, clubMayUseEvent: async () => true }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/organizations/area-coordinators", () => ({ currentAreaCoordinator: mocks.currentAreaCoordinator, isAreaCoordinator: mocks.isAreaCoordinator }));
vi.mock("@/modules/club-rosters/access", async () => {
  const actual = await vi.importActual<typeof import("@/modules/club-rosters/access")>("@/modules/club-rosters/access");
  return { ...actual, requireRosterAccess: mocks.requireRosterAccess };
});
vi.mock("@/modules/club-teachers/settings", async () => {
  const actual = await vi.importActual<typeof import("@/modules/club-teachers/settings")>("@/modules/club-teachers/settings");
  return { ...actual, applyTeacherSettings: mocks.applyTeacherSettings };
});
vi.mock("@/modules/club-teachers/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/club-teachers/repository")>("@/modules/club-teachers/repository");
  return { ...actual, setClubTeachers: mocks.setClubTeachers };
});

import { PUT as coordinatorPut } from "@/app/api/attendee/area-clubs/events/[eventId]/club-teachers/route";
import { PUT as clubPut } from "@/app/api/attendee/clubs/[organizationId]/events/[eventId]/teachers/route";
import { RosterAccessError } from "@/modules/club-rosters/access";
import { ClubTeacherError } from "@/modules/club-teachers/repository";

const rule = { baseTeachers: 1, largerClubOver: 10, largerClubTeachers: 2, requireTeachers: false };
const put = (url: string, body: unknown) => new Request(url, {
  method: "PUT",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});
const acCtx = { params: Promise.resolve({ eventId: "event-1" }) };
const clubCtx = { params: Promise.resolve({ organizationId: "club-1", eventId: "event-1" }) };
const acRequest = (body: unknown) => put("https://events.imsda.test/api/attendee/area-clubs/events/event-1/club-teachers", body);
const clubRequest = (body: unknown) => put("https://events.imsda.test/api/attendee/clubs/club-1/events/event-1/teachers", body);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.isAreaCoordinator.mockResolvedValue(true);
});

describe("PUT area-clubs/events/[eventId]/club-teachers (#1681)", () => {
  it("refuses, as not found, anyone who is not a coordinator with an active grant and the second sign-in step", async () => {
    // `currentAreaCoordinator` is null for no grant, a revoked grant, and a session without a real second step.
    mocks.currentAreaCoordinator.mockResolvedValue(null);
    const response = await coordinatorPut(acRequest({ enabled: true }), acCtx);
    expect(response.status).toBe(404);
    expect(mocks.applyTeacherSettings).not.toHaveBeenCalled();
  });

  it("lets an active coordinator switch it, attributed to their own account", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-ac" });
    mocks.applyTeacherSettings.mockResolvedValue({ enabled: true, rule: null, eventName: "Honors Weekend" });
    const response = await coordinatorPut(acRequest({ enabled: true }), acCtx);
    expect(response.status).toBe(200);
    expect(mocks.applyTeacherSettings).toHaveBeenCalledWith({ kind: "area-coordinator", accountId: "acct-ac" }, "event-1", { enabled: true });
  });

  it("answers 403 when a coordinator asks to require teachers", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-ac" });
    mocks.applyTeacherSettings.mockRejectedValue(new ClubTeacherError("NOT_PERMITTED", "Only the Clubs Administrator or event staff can require teachers."));
    const response = await coordinatorPut(acRequest({ rule: { ...rule, requireTeachers: true } }), acCtx);
    expect(response.status).toBe(403);
  });

  it("rejects fields the tool does not have", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-ac" });
    expect((await coordinatorPut(acRequest({ enabled: true, moduleKey: "merchandise" }), acCtx)).status).toBe(400);
    expect(mocks.applyTeacherSettings).not.toHaveBeenCalled();
  });
});

describe("PUT clubs/[organizationId]/events/[eventId]/teachers (#1681)", () => {
  const body = { teachers: [{ rosterMemberId: "m1", honorName: null, locationId: null }] };

  it("needs the register-for-events role: a reporter is refused and nothing is saved", async () => {
    mocks.requireRosterAccess.mockRejectedValue(new RosterAccessError("ROLE_NOT_ALLOWED", 403, "Your club role doesn't include this."));
    expect((await clubPut(clubRequest(body), clubCtx)).status).toBe(403);
    expect(mocks.requireRosterAccess).toHaveBeenCalledWith("club-1", expect.any(Date), "registerForEvents");
    expect(mocks.setClubTeachers).not.toHaveBeenCalled();
  });

  it("gives a coordinator, who directs no club, the same not found as any stranger", async () => {
    mocks.requireRosterAccess.mockRejectedValue(new RosterAccessError("NOT_FOUND", 404, "That club could not be found."));
    expect((await clubPut(clubRequest(body), clubCtx)).status).toBe(404);
    expect(mocks.setClubTeachers).not.toHaveBeenCalled();
  });

  it("saves for a director, attributed to their account", async () => {
    mocks.requireRosterAccess.mockResolvedValue({ state: "OPEN", actor: { kind: "ATTENDEE", accountId: "director-1", sessionId: "s1" } });
    mocks.setClubTeachers.mockResolvedValue(null);
    expect((await clubPut(clubRequest(body), clubCtx)).status).toBe(200);
    expect(mocks.setClubTeachers).toHaveBeenCalledWith("club-1", "event-1", { accountId: "director-1" }, body);
  });

  it("answers 422 with a clear message when a teacher is under 18 or has no known age (#1727)", async () => {
    mocks.requireRosterAccess.mockResolvedValue({ state: "OPEN", actor: { kind: "ATTENDEE", accountId: "director-1", sessionId: "s1" } });
    mocks.setClubTeachers.mockRejectedValueOnce(new ClubTeacherError("TEACHER_UNDER_18", "Teachers must be 18 or older. Remove anyone under 18 and name an adult instead."));
    const under = await clubPut(clubRequest(body), clubCtx);
    expect(under.status).toBe(422);
    expect(await under.json()).toMatchObject({ error: "TEACHER_UNDER_18", message: expect.stringContaining("18 or older") });
    mocks.setClubTeachers.mockRejectedValueOnce(new ClubTeacherError("TEACHER_AGE_UNKNOWN", "A teacher's age is needed. Add the birth date on your roster first."));
    const unknown = await clubPut(clubRequest(body), clubCtx);
    expect(unknown.status).toBe(422);
    expect(await unknown.json()).toMatchObject({ error: "TEACHER_AGE_UNKNOWN", message: expect.stringContaining("birth date") });
  });
});
