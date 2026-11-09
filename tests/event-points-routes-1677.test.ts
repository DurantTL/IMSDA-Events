import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentAreaCoordinator: vi.fn(),
  isAreaCoordinator: vi.fn(),
  applyAttendancePointsAction: vi.fn(),
  getCurrentSession: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/organizations/area-coordinators", () => ({ currentAreaCoordinator: mocks.currentAreaCoordinator, isAreaCoordinator: mocks.isAreaCoordinator }));
vi.mock("@/modules/event-points/service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/event-points/service")>("@/modules/event-points/service");
  return { ...actual, applyAttendancePointsAction: mocks.applyAttendancePointsAction };
});

import { PUT as coordinatorPut } from "@/app/api/attendee/area-clubs/events/[eventId]/attendance-points/route";
import { PUT as staffPut } from "@/app/api/events/[eventId]/attendance-points/route";
import { AttendancePointsError, pointsCapabilities } from "@/modules/event-points/service";

const put = (url: string, body: unknown) => new Request(url, {
  method: "PUT",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});
const ctx = { params: Promise.resolve({ eventId: "event-1" }) };
const acRequest = (body: unknown) => put("https://events.imsda.test/api/attendee/area-clubs/events/event-1/attendance-points", body);
const staffRequest = (body: unknown) => put("https://events.imsda.test/api/events/event-1/attendance-points", body);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.isAreaCoordinator.mockResolvedValue(true);
});

describe("PUT area-clubs/events/[eventId]/attendance-points (#1677)", () => {
  it("refuses, as not found, anyone who is not a coordinator with an active grant and the second sign-in step", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue(null);
    expect((await coordinatorPut(acRequest({ action: "switch", enabled: true }), ctx)).status).toBe(404);
    expect(mocks.applyAttendancePointsAction).not.toHaveBeenCalled();
  });

  it("lets an active coordinator act, attributed to their own account", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-ac" });
    mocks.applyAttendancePointsAction.mockResolvedValue({ enabled: true });
    expect((await coordinatorPut(acRequest({ action: "saveSettings", points: 1500, requiresPathfinders: true }), ctx)).status).toBe(200);
    expect(mocks.applyAttendancePointsAction).toHaveBeenCalledWith({ kind: "area-coordinator", accountId: "acct-ac" }, "event-1", { action: "saveSettings", points: 1500, requiresPathfinders: true });
  });

  it("answers 403 when a coordinator tries to apply, and 400 for anything the tool does not have", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-ac" });
    mocks.applyAttendancePointsAction.mockRejectedValue(new AttendancePointsError("NOT_PERMITTED", "Only the Clubs Administrator or event administrators can apply or undo points."));
    expect((await coordinatorPut(acRequest({ action: "apply" }), ctx)).status).toBe(403);
    mocks.applyAttendancePointsAction.mockClear();
    expect((await coordinatorPut(acRequest({ action: "switch", enabled: true, moduleKey: "merchandise" }), ctx)).status).toBe(400);
    expect(mocks.applyAttendancePointsAction).not.toHaveBeenCalled();
  });

  it("answers 422 with the field for an invalid override", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-ac" });
    mocks.applyAttendancePointsAction.mockRejectedValue(new AttendancePointsError("INVALID", "Give a reason for the override.", "reason"));
    const response = await coordinatorPut(acRequest({ action: "override", organizationId: "c1", outcome: "AWARD", reason: "" }), ctx);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ field: "reason" });
  });

  it("refuses a cross-origin request before anything else", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(new Response(null, { status: 403 }));
    expect((await coordinatorPut(acRequest({ action: "apply" }), ctx)).status).toBe(403);
    expect(mocks.currentAreaCoordinator).not.toHaveBeenCalled();
  });
});

describe("PUT events/[eventId]/attendance-points (#1677)", () => {
  it("refuses a request with no signed-in user", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await staffPut(staffRequest({ action: "apply" }), ctx)).status).toBeGreaterThanOrEqual(401);
    expect(mocks.applyAttendancePointsAction).not.toHaveBeenCalled();
  });
});

describe("what each kind of person may do (#1677)", () => {
  it("gives staff everything, a coordinator the switch and the points with counts only", () => {
    expect(pointsCapabilities({ kind: "staff", userId: "u" })).toEqual({ canSwitch: true, canSetUp: true, canSeeNames: true, canMark: true, canOverride: true, canApply: true });
    expect(pointsCapabilities({ kind: "area-coordinator", accountId: "a" })).toEqual({ canSwitch: true, canSetUp: true, canSeeNames: false, canMark: false, canOverride: false, canApply: false });
  });
});
