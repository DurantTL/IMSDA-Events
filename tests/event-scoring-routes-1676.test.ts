import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentAreaCoordinator: vi.fn(),
  isAreaCoordinator: vi.fn(),
  applyEventScoringAction: vi.fn(),
  getCurrentSession: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/organizations/area-coordinators", () => ({ currentAreaCoordinator: mocks.currentAreaCoordinator, isAreaCoordinator: mocks.isAreaCoordinator }));
vi.mock("@/modules/event-scoring/service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/event-scoring/service")>("@/modules/event-scoring/service");
  return { ...actual, applyEventScoringAction: mocks.applyEventScoringAction };
});

import { PUT as coordinatorPut } from "@/app/api/attendee/area-clubs/events/[eventId]/event-scoring/route";
import { PUT as staffPut } from "@/app/api/events/[eventId]/event-scoring/route";
import { EventScoringError, scoringCapabilities } from "@/modules/event-scoring/service";

const put = (url: string, body: unknown) => new Request(url, {
  method: "PUT",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});
const ctx = { params: Promise.resolve({ eventId: "event-1" }) };
const acRequest = (body: unknown) => put("https://events.imsda.test/api/attendee/area-clubs/events/event-1/event-scoring", body);
const staffRequest = (body: unknown) => put("https://events.imsda.test/api/events/event-1/event-scoring", body);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.isAreaCoordinator.mockResolvedValue(true);
});

describe("PUT area-clubs/events/[eventId]/event-scoring (#1676)", () => {
  it("refuses, as not found, anyone who is not a coordinator with an active grant and the second sign-in step", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue(null);
    expect((await coordinatorPut(acRequest({ action: "switch", enabled: true }), ctx)).status).toBe(404);
    expect(mocks.applyEventScoringAction).not.toHaveBeenCalled();
  });

  it("lets an active coordinator act, attributed to their own account", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-ac" });
    mocks.applyEventScoringAction.mockResolvedValue({ enabled: true });
    expect((await coordinatorPut(acRequest({ action: "switch", enabled: true }), ctx)).status).toBe(200);
    expect(mocks.applyEventScoringAction).toHaveBeenCalledWith({ kind: "area-coordinator", accountId: "acct-ac" }, "event-1", { action: "switch", enabled: true });
  });

  it("answers 403 when a coordinator tries to publish, and 400 for anything the tool does not have", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-ac" });
    mocks.applyEventScoringAction.mockRejectedValue(new EventScoringError("NOT_PERMITTED", "Only the Clubs Administrator or event administrators can publish results."));
    expect((await coordinatorPut(acRequest({ action: "publish" }), ctx)).status).toBe(403);
    mocks.applyEventScoringAction.mockClear();
    expect((await coordinatorPut(acRequest({ action: "switch", enabled: true, moduleKey: "merchandise" }), ctx)).status).toBe(400);
    expect(mocks.applyEventScoringAction).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request before anything else", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(new Response(null, { status: 403 }));
    expect((await coordinatorPut(acRequest({ action: "publish" }), ctx)).status).toBe(403);
    expect(mocks.currentAreaCoordinator).not.toHaveBeenCalled();
  });
});

describe("PUT events/[eventId]/event-scoring (#1676)", () => {
  it("refuses a request with no signed-in user", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await staffPut(staffRequest({ action: "publish" }), ctx)).status).toBeGreaterThanOrEqual(401);
    expect(mocks.applyEventScoringAction).not.toHaveBeenCalled();
  });
});

describe("what each kind of person may do (#1676)", () => {
  it("gives an administrator everything, a coordinator everything but publishing, a registration manager scores only", () => {
    expect(scoringCapabilities({ kind: "staff", userId: "u", administrator: true })).toEqual({ canSwitch: true, canDefine: true, canEnter: true, canPublish: true, canCorrectAfterPublish: true });
    expect(scoringCapabilities({ kind: "area-coordinator", accountId: "a" })).toEqual({ canSwitch: true, canDefine: true, canEnter: true, canPublish: false, canCorrectAfterPublish: false });
    expect(scoringCapabilities({ kind: "staff", userId: "u", administrator: false })).toEqual({ canSwitch: false, canDefine: false, canEnter: true, canPublish: false, canCorrectAfterPublish: false });
  });
});
