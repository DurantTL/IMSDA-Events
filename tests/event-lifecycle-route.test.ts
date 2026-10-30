import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => {
  class MockEventLifecycleError extends Error {
    constructor(public readonly code: string, message: string, public readonly currentState?: string) {
      super(message);
    }
  }
  class MockEventOperationError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  }
  return {
    EventLifecycleError: MockEventLifecycleError,
    EventOperationError: MockEventOperationError,
    findActiveMembership: vi.fn(),
    getCurrentSession: vi.fn(),
    getEventLifecycle: vi.fn(),
    transitionEventLifecycle: vi.fn(),
  };
});

vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: dependencies.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({
  EventOperationError: dependencies.EventOperationError,
  findActiveMembership: dependencies.findActiveMembership,
}));
vi.mock("@/modules/events/lifecycle-repository", () => ({
  EventLifecycleError: dependencies.EventLifecycleError,
  getEventLifecycle: dependencies.getEventLifecycle,
  transitionEventLifecycle: dependencies.transitionEventLifecycle,
}));

import { GET, POST } from "@/app/api/events/[eventId]/lifecycle/route";

const context = { params: Promise.resolve({ eventId: "evt_1" }) };
const request = (body: unknown, origin = "https://events.imsda.test") => new Request("https://events.imsda.test/api/events/evt_1/lifecycle", {
  method: "POST",
  headers: { "content-type": "application/json", origin },
  body: JSON.stringify(body),
});
const valid = { toState: "REGISTRATION_CLOSED", expectedFromState: "PUBLISHED", reason: "Capacity reached" };

const asStaff = (role: "EVENT_ADMIN" | "FINANCE_MANAGER" | "READ_ONLY_STAFF", extra: string[] = []) => {
  dependencies.getCurrentSession.mockResolvedValue({ user: { id: "usr_1", email: "staff@example.test", displayName: "Staff", globalRole: null } });
  dependencies.findActiveMembership.mockResolvedValue({ eventId: "evt_1", userId: "usr_1", role, status: "ACTIVE", permissions: extra });
};

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.getEventLifecycle.mockResolvedValue({ state: "REGISTRATION_CLOSED" });
  dependencies.transitionEventLifecycle.mockResolvedValue({ changed: true });
});

describe("POST /api/events/[eventId]/lifecycle", () => {
  it("requires a signed-in account", async () => {
    dependencies.getCurrentSession.mockResolvedValue({ user: null });
    expect((await POST(request(valid), context)).status).toBe(401);
    expect(dependencies.transitionEventLifecycle).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request", async () => {
    asStaff("EVENT_ADMIN");
    expect((await POST(request(valid, "https://evil.example"), context)).status).toBe(403);
    expect(dependencies.transitionEventLifecycle).not.toHaveBeenCalled();
  });

  it("refuses an account with no role on the event", async () => {
    asStaff("EVENT_ADMIN");
    dependencies.findActiveMembership.mockResolvedValue(null);
    expect((await POST(request(valid), context)).status).toBe(403);
    expect(dependencies.transitionEventLifecycle).not.toHaveBeenCalled();
  });

  it("validates the body: states, a required expected state, a reason of at most 500 characters, no extra keys", async () => {
    asStaff("EVENT_ADMIN");
    for (const body of [{}, { toState: "NOPE", expectedFromState: "DRAFT" }, { toState: "TEST" }, { ...valid, reason: "x".repeat(501) }, { ...valid, extra: 1 }, null]) {
      expect((await POST(request(body), context)).status, JSON.stringify(body)).toBe(400);
    }
    expect(dependencies.transitionEventLifecycle).not.toHaveBeenCalled();
  });

  it("hands the transition the actor's real permissions and returns the new state", async () => {
    asStaff("EVENT_ADMIN");
    const response = await POST(request(valid), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ changed: true, lifecycle: { state: "REGISTRATION_CLOSED" } });
    const call = dependencies.transitionEventLifecycle.mock.calls[0]![0];
    expect(call).toMatchObject({ eventId: "evt_1", toState: "REGISTRATION_CLOSED", expectedFromState: "PUBLISHED", reason: "Capacity reached" });
    expect(call.actor.userId).toBe("usr_1");
    expect(call.actor.permissions).toContain("CONFIGURE_EVENT");
  });

  it("gives a finance manager MANAGE_FINANCE but not CONFIGURE_EVENT, so each transition's own permission decides", async () => {
    asStaff("FINANCE_MANAGER");
    await POST(request({ toState: "CLOSED", expectedFromState: "FINANCIAL_RECONCILIATION" }), context);
    const permissions = dependencies.transitionEventLifecycle.mock.calls[0]![0].actor.permissions;
    expect(permissions).toContain("MANAGE_FINANCE");
    expect(permissions).not.toContain("CONFIGURE_EVENT");
  });

  it("maps typed refusals: permission 403, conflict and others 409, missing 404, unexpected 500", async () => {
    asStaff("READ_ONLY_STAFF");
    const cases: Array<[unknown, number, string]> = [
      [new dependencies.EventLifecycleError("PERMISSION_DENIED", "no"), 403, "LIFECYCLE_PERMISSION_DENIED"],
      [new dependencies.EventLifecycleError("CONFLICT", "moved", "TEST"), 409, "LIFECYCLE_CONFLICT"],
      [new dependencies.EventLifecycleError("UNKNOWN_TRANSITION", "nope"), 409, "LIFECYCLE_UNKNOWN_TRANSITION"],
      [new dependencies.EventLifecycleError("CONDITION_UNMET", "not yet"), 409, "LIFECYCLE_CONDITION_UNMET"],
      [new dependencies.EventOperationError("EVENT_NOT_READY", "checklist"), 409, "EVENT_NOT_READY"],
      [new dependencies.EventOperationError("EVENT_NOT_FOUND", "gone"), 404, "EVENT_NOT_FOUND"],
      [new Error("boom"), 500, "EVENT_LIFECYCLE_FAILED"],
    ];
    for (const [error, status, code] of cases) {
      dependencies.transitionEventLifecycle.mockRejectedValueOnce(error);
      const response = await POST(request(valid), context);
      expect(response.status).toBe(status);
      expect((await response.json()).error).toBe(code);
    }
  });
});

describe("GET /api/events/[eventId]/lifecycle", () => {
  it("returns state, history and allowed moves for a member", async () => {
    asStaff("READ_ONLY_STAFF");
    const response = await GET(new Request("https://events.imsda.test/api/events/evt_1/lifecycle"), context);
    expect(response.status).toBe(200);
    expect(dependencies.getEventLifecycle).toHaveBeenCalledWith(expect.objectContaining({ eventId: "evt_1", permissions: expect.arrayContaining(["VIEW_EVENT"]) }));
  });

  it("is 404 for a missing event and refuses a non-member", async () => {
    asStaff("READ_ONLY_STAFF");
    dependencies.getEventLifecycle.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://events.imsda.test/x"), context)).status).toBe(404);
    dependencies.findActiveMembership.mockResolvedValue(null);
    expect((await GET(new Request("https://events.imsda.test/x"), context)).status).toBe(403);
  });
});
