import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentAreaCoordinator: vi.fn(),
  isAreaCoordinator: vi.fn(),
  applyCamporeeAction: vi.fn(),
  getCurrentSession: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/organizations/area-coordinators", () => ({ currentAreaCoordinator: mocks.currentAreaCoordinator, isAreaCoordinator: mocks.isAreaCoordinator }));
vi.mock("@/modules/camporee-scoring/service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/camporee-scoring/service")>("@/modules/camporee-scoring/service");
  return { ...actual, applyCamporeeAction: mocks.applyCamporeeAction };
});

import { PUT as coordinatorPut } from "@/app/api/attendee/area-clubs/events/[eventId]/camporee-scoring/route";
import { PUT as staffPut } from "@/app/api/events/[eventId]/camporee-scoring/route";
import { CamporeeScoringError, scoringCapabilities } from "@/modules/camporee-scoring/service";

const put = (url: string, body: unknown) => new Request(url, {
  method: "PUT",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});
const ctx = { params: Promise.resolve({ eventId: "event-1" }) };
const acRequest = (body: unknown) => put("https://events.imsda.test/api/attendee/area-clubs/events/event-1/camporee-scoring", body);
const staffRequest = (body: unknown) => put("https://events.imsda.test/api/events/event-1/camporee-scoring", body);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.isAreaCoordinator.mockResolvedValue(true);
});

describe("PUT area-clubs/events/[eventId]/camporee-scoring (#1676)", () => {
  it("refuses, as not found, anyone who is not a coordinator with an active grant and the second sign-in step", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue(null);
    expect((await coordinatorPut(acRequest({ action: "switch", enabled: true }), ctx)).status).toBe(404);
    expect(mocks.applyCamporeeAction).not.toHaveBeenCalled();
  });

  it("lets an active coordinator act, attributed to their own account", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-ac" });
    mocks.applyCamporeeAction.mockResolvedValue({ enabled: true });
    expect((await coordinatorPut(acRequest({ action: "switch", enabled: true }), ctx)).status).toBe(200);
    expect(mocks.applyCamporeeAction).toHaveBeenCalledWith({ kind: "area-coordinator", accountId: "acct-ac" }, "event-1", { action: "switch", enabled: true });
  });

  it("answers 403 when a coordinator tries to publish, and 400 for anything the tool does not have", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-ac" });
    mocks.applyCamporeeAction.mockRejectedValue(new CamporeeScoringError("NOT_PERMITTED", "Only the Clubs Administrator or event administrators can publish results."));
    expect((await coordinatorPut(acRequest({ action: "publish" }), ctx)).status).toBe(403);
    mocks.applyCamporeeAction.mockClear();
    expect((await coordinatorPut(acRequest({ action: "switch", enabled: true, moduleKey: "merchandise" }), ctx)).status).toBe(400);
    expect(mocks.applyCamporeeAction).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request before anything else", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(new Response(null, { status: 403 }));
    expect((await coordinatorPut(acRequest({ action: "publish" }), ctx)).status).toBe(403);
    expect(mocks.currentAreaCoordinator).not.toHaveBeenCalled();
  });
});

describe("PUT events/[eventId]/camporee-scoring (#1676)", () => {
  it("refuses a request with no signed-in user", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await staffPut(staffRequest({ action: "publish" }), ctx)).status).toBeGreaterThanOrEqual(401);
    expect(mocks.applyCamporeeAction).not.toHaveBeenCalled();
  });
});

describe("what each kind of person may do (#1676)", () => {
  it("gives an administrator everything, a coordinator everything but publishing, a registration manager scores only", () => {
    expect(scoringCapabilities({ kind: "staff", userId: "u", administrator: true })).toEqual({ canSwitch: true, canDefine: true, canEnter: true, canPublish: true, canCorrectAfterPublish: true });
    expect(scoringCapabilities({ kind: "area-coordinator", accountId: "a" })).toEqual({ canSwitch: true, canDefine: true, canEnter: true, canPublish: false, canCorrectAfterPublish: false });
    expect(scoringCapabilities({ kind: "staff", userId: "u", administrator: false })).toEqual({ canSwitch: false, canDefine: false, canEnter: true, canPublish: false, canCorrectAfterPublish: false });
  });
});
