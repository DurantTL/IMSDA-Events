import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Editing a person's class history (#1011): the routes behind the real roster
 * gate (director, deputy and registrar edit; a reporter, another club's
 * director and a signed-out request do not). Only the lookups underneath and
 * the storage are stubbed. Synthetic data only.
 */
const mocks = vi.hoisted(() => ({
  getCurrentAttendee: vi.fn(),
  listDirectedClubs: vi.fn(),
  findEnrollment: vi.fn(),
  findSession: vi.fn(),
  countPasskeys: vi.fn(),
  findSettings: vi.fn(),
  findOrganization: vi.fn(),
  acting: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  add: vi.fn(),
  change: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    attendeeMfaEnrollment: { findUnique: mocks.findEnrollment },
    attendeeSession: { findUnique: mocks.findSession },
    attendeePasskey: { count: mocks.countPasskeys },
    platformSettings: { findUnique: mocks.findSettings },
    organization: { findUnique: mocks.findOrganization },
  }),
}));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: mocks.listDirectedClubs }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.acting }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/earned-awards/order-source", () => ({
  addMemberClassCompletion: mocks.add,
  changeMemberClassCompletionDate: mocks.change,
  removeMemberClassCompletion: mocks.remove,
}));

import { POST } from "@/app/api/attendee/clubs/[organizationId]/class-history/[personId]/route";
import { DELETE, PATCH } from "@/app/api/attendee/clubs/[organizationId]/class-history/[personId]/[classLevel]/route";
import { ClubOrderError } from "@/modules/club-orders/repository";

const clubFor = (organizationId: string, role: string) => ({ organizationId, name: "Test Pathfinders", role, sponsoringChurch: null });
const account = { id: "director-1", verifiedEmail: "director@example.test", displayName: "Test Director" };
const ctx = (organizationId = "club-1", classLevel?: string) => ({ params: Promise.resolve({ organizationId, personId: "person-1", classLevel: classLevel ?? "FRIEND" }) });
const request = (method: string, body?: unknown) => new Request("https://events.imsda.test/api/x", {
  method,
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const addBody = { classLevel: "FRIEND", completedOn: "2025-06-01", needsInsignia: false };

type Call = [string, () => Promise<Response>, () => unknown];
const calls = (organizationId = "club-1"): Call[] => [
  ["add", () => POST(request("POST", addBody), ctx(organizationId)), () => mocks.add],
  ["change date", () => PATCH(request("PATCH", { completedOn: "2025-06-02" }), ctx(organizationId)), () => mocks.change],
  ["remove", () => DELETE(request("DELETE"), ctx(organizationId)), () => mocks.remove],
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCurrentAttendee.mockResolvedValue({ account, via: "attendee", sessionId: "session-1" });
  mocks.listDirectedClubs.mockResolvedValue([clubFor("club-1", "DIRECTOR")]);
  mocks.findEnrollment.mockResolvedValue({ status: "ACTIVE" });
  mocks.findSession.mockResolvedValue({ secondFactorVerifiedAt: new Date(Date.now() - 60_000) });
  mocks.countPasskeys.mockResolvedValue(0);
  mocks.findSettings.mockResolvedValue({ passkeyRpId: null });
  mocks.findOrganization.mockResolvedValue({ type: "CLUB", isActive: true, name: "Test Pathfinders", parentOrganization: null });
  mocks.acting.mockResolvedValue(null);
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  for (const mock of [mocks.add, mocks.change, mocks.remove]) mock.mockResolvedValue({ ok: true });
});

describe("class history edit routes (#1011)", () => {
  it.each(["DIRECTOR", "DEPUTY", "REGISTRAR"])("a %s can add, change a date and remove", async (role) => {
    mocks.listDirectedClubs.mockResolvedValue([clubFor("club-1", role)]);
    for (const [label, run, storage] of calls()) {
      expect((await run()).status, label).toBeLessThan(300);
      expect(storage(), label).toHaveBeenCalledTimes(1);
    }
    expect(mocks.add).toHaveBeenCalledWith("club-1", "person-1", addBody, { accountId: "director-1" });
    expect(mocks.change).toHaveBeenCalledWith("club-1", "person-1", "FRIEND", "2025-06-02", { accountId: "director-1" });
    expect(mocks.remove).toHaveBeenCalledWith("club-1", "person-1", "FRIEND", { accountId: "director-1" });
  });

  it("a reporter is refused with 403", async () => {
    mocks.listDirectedClubs.mockResolvedValue([clubFor("club-1", "REPORTER")]);
    for (const [label, run, storage] of calls()) {
      expect((await run()).status, label).toBe(403);
      expect(storage(), label).not.toHaveBeenCalled();
    }
  });

  it("another club's director gets 404", async () => {
    for (const [label, run, storage] of calls("club-2")) {
      expect((await run()).status, label).toBe(404);
      expect(storage(), label).not.toHaveBeenCalled();
    }
  });

  it("a signed-out request gets 401", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    for (const [label, run, storage] of calls()) {
      expect((await run()).status, label).toBe(401);
      expect(storage(), label).not.toHaveBeenCalled();
    }
  });

  it("a pending sign-in second step, an unset authenticator and a locked roster are refused", async () => {
    mocks.accountNeedsSecondStep.mockResolvedValue("REQUIRED");
    for (const [label, run, storage] of calls()) {
      expect((await run()).status, label).toBe(403);
      expect(storage(), label).not.toHaveBeenCalled();
    }
    mocks.accountNeedsSecondStep.mockResolvedValue("OK");
    mocks.findEnrollment.mockResolvedValue(null);
    expect((await POST(request("POST", addBody), ctx())).status).toBe(403);
    mocks.findEnrollment.mockResolvedValue({ status: "ACTIVE" });
    mocks.findSession.mockResolvedValue({ secondFactorVerifiedAt: new Date(Date.now() - 13 * 3_600_000) });
    expect((await DELETE(request("DELETE"), ctx())).status).toBe(403);
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("a staff act-as director of this club is allowed and attributed to the staff user, and another club's act-as is refused", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    mocks.acting.mockResolvedValue({ role: "CLUB_DIRECTOR", organizationId: "club-1", userId: "staff-1", staffSessionId: "s1", actAsId: "act-1" });
    expect((await POST(request("POST", addBody), ctx())).status).toBe(201);
    expect(mocks.add).toHaveBeenCalledWith("club-1", "person-1", addBody, { userId: "staff-1", actAsId: "act-1" });
    expect((await POST(request("POST", addBody), ctx("club-2"))).status).toBe(401);
  });

  it("an act-as Area Coordinator cannot edit", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    mocks.acting.mockResolvedValue({ role: "AREA_COORDINATOR", organizationId: null, userId: "staff-1", staffSessionId: "s1", actAsId: "act-1" });
    for (const [label, run, storage] of calls()) {
      expect((await run()).status, label).toBe(401);
      expect(storage(), label).not.toHaveBeenCalled();
    }
  });

  it("refuses malformed input with 400 before touching storage", async () => {
    expect((await POST(request("POST", { ...addBody, classLevel: "WIZARD" }), ctx())).status).toBe(400);
    expect((await POST(request("POST", { ...addBody, completedOn: "2026-13-45" }), ctx())).status).toBe(400);
    expect((await POST(request("POST", { classLevel: "FRIEND", completedOn: "2025-06-01" }), ctx())).status).toBe(400);
    expect((await POST(request("POST", { ...addBody, organizationId: "club-2" }), ctx())).status).toBe(400);
    expect((await PATCH(request("PATCH", { completedOn: "soon" }), ctx())).status).toBe(400);
    expect((await PATCH(request("PATCH", { completedOn: "2025-06-02" }), ctx("club-1", "WIZARD"))).status).toBe(400);
    expect((await DELETE(request("DELETE"), ctx("club-1", "WIZARD"))).status).toBe(400);
    for (const [, , storage] of calls()) expect(storage()).not.toHaveBeenCalled();
  });

  it("maps domain refusals to statuses", async () => {
    mocks.add.mockRejectedValue(new ClubOrderError("CLASS_ALREADY_COMPLETED", "Friend is already recorded for this person."));
    expect((await POST(request("POST", addBody), ctx())).status).toBe(409);
    mocks.add.mockRejectedValue(new ClubOrderError("DATE_IN_FUTURE", "The completed date can't be in the future."));
    expect((await POST(request("POST", addBody), ctx())).status).toBe(400);
    // Another club's person gets the page's own answer: 404.
    mocks.add.mockRejectedValue(new ClubOrderError("MEMBER_NOT_ON_ROSTER", "That person isn't on this club's roster."));
    expect((await POST(request("POST", addBody), ctx())).status).toBe(404);
    mocks.change.mockRejectedValue(new ClubOrderError("MEMBER_NOT_ON_ROSTER", "That person isn't on this club's roster."));
    expect((await PATCH(request("PATCH", { completedOn: "2025-06-02" }), ctx())).status).toBe(404);
    mocks.remove.mockRejectedValue(new ClubOrderError("CLASS_NOT_COMPLETED", "Friend isn't recorded for this person."));
    expect((await DELETE(request("DELETE"), ctx())).status).toBe(404);
  });
});
