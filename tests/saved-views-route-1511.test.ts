import { beforeEach, describe, expect, it, vi } from "vitest";

// #1511: the saved view routes check the origin and the signed-in person, validate the body, and map errors to statuses.
const mocks = vi.hoisted(() => {
  class MockAccessDeniedError extends Error {
    constructor(message: string, public readonly status = 403, public readonly code = "PERMISSION_DENIED") { super(message); }
  }
  class MockSavedViewError extends Error {
    constructor(public readonly code: "INVALID" | "NOT_FOUND" | "NAME_TAKEN" | "LIMIT_REACHED", message: string) { super(message); }
  }
  return {
    AccessDeniedError: MockAccessDeniedError,
    SavedViewError: MockSavedViewError,
    requirePermission: vi.fn(),
    getCurrentSession: vi.fn(),
    rejectCrossOriginRequest: vi.fn(),
    createSavedView: vi.fn(),
    setSavedViewShared: vi.fn(),
    deleteSavedView: vi.fn(),
  };
});

vi.mock("@/modules/access/authorization", async () => {
  const actual = await vi.importActual<typeof import("@/modules/access/authorization")>("@/modules/access/authorization");
  return { ...actual, AccessDeniedError: mocks.AccessDeniedError, requirePermission: mocks.requirePermission };
});
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: vi.fn() }));
vi.mock("@/modules/registrations/saved-views-repository", () => ({
  SavedViewError: mocks.SavedViewError,
  createSavedView: mocks.createSavedView,
  setSavedViewShared: mocks.setSavedViewShared,
  deleteSavedView: mocks.deleteSavedView,
}));

import { POST } from "@/app/api/events/[eventId]/registration-views/route";
import { DELETE, PATCH } from "@/app/api/events/[eventId]/registration-views/[viewId]/route";

const json = (method: string, body: unknown) => new Request("https://events.example.test/api", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const create = { params: Promise.resolve({ eventId: "event-1" }) };
const one = { params: Promise.resolve({ eventId: "event-1", viewId: "view-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-a" } });
  mocks.requirePermission.mockResolvedValue({ user: { id: "user-a", email: "a@example.test", displayName: "Alex", globalRole: null }, membership: { eventId: "event-1", userId: "user-a", role: "CHECK_IN_STAFF", status: "ACTIVE", permissions: [] } });
});

describe("registration views routes", () => {
  it("creates a view as the signed-in person after checking the list permission", async () => {
    mocks.createSavedView.mockResolvedValue({ id: "view-1", name: "Mine", query: "status=CONFIRMED", shared: false });
    const response = await POST(json("POST", { name: "Mine", query: "status=CONFIRMED" }), create);
    expect(response.status).toBe(201);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "event-1", "VIEW_SENSITIVE_DATA", expect.anything());
    expect(mocks.createSavedView).toHaveBeenCalledWith(expect.objectContaining({ eventId: "event-1", userId: "user-a", permissions: expect.arrayContaining(["VIEW_SENSITIVE_DATA"]) }), { name: "Mine", query: "status=CONFIRMED" });
  });

  it("rejects a cross-origin write before anything else", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    for (const response of [await POST(json("POST", {}), create), await PATCH(json("PATCH", { shared: true }), one), await DELETE(json("DELETE", {}), one)]) expect(response.status).toBe(403);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
  });

  it("answers a bad body 400, a refused person with its status, a missing view 404 and a taken name 409", async () => {
    expect((await POST(json("POST", { query: "status=CONFIRMED" }), create)).status).toBe(400);
    expect((await PATCH(json("PATCH", { shared: "yes" }), one)).status).toBe(400);
    mocks.setSavedViewShared.mockRejectedValueOnce(new mocks.AccessDeniedError("No.", 403, "PERMISSION_DENIED"));
    expect((await PATCH(json("PATCH", { shared: true }), one)).status).toBe(403);
    mocks.deleteSavedView.mockRejectedValueOnce(new mocks.SavedViewError("NOT_FOUND", "Missing."));
    expect((await DELETE(json("DELETE", {}), one)).status).toBe(404);
    mocks.createSavedView.mockRejectedValueOnce(new mocks.SavedViewError("NAME_TAKEN", "Taken."));
    expect((await POST(json("POST", { name: "Mine", query: "status=CONFIRMED" }), create)).status).toBe(409);
    mocks.createSavedView.mockRejectedValueOnce(new mocks.SavedViewError("INVALID", "Nope."));
    expect((await POST(json("POST", { name: "Mine", query: "tag=gone" }), create)).status).toBe(400);
  });

  it("answers someone without access with the permission status and never reaches the repository", async () => {
    mocks.requirePermission.mockRejectedValue(new mocks.AccessDeniedError("No access.", 403, "EVENT_ACCESS_DENIED"));
    expect((await POST(json("POST", { name: "Mine", query: "status=CONFIRMED" }), create)).status).toBe(403);
    expect(mocks.createSavedView).not.toHaveBeenCalled();
  });
});

describe("permissions come from the server, not the request", () => {
  it("never grants sharing to a role without MANAGE_REGISTRATION, whatever the body says", async () => {
    mocks.createSavedView.mockResolvedValue({ id: "view-1", name: "Mine", query: "status=CONFIRMED", shared: false });
    await POST(json("POST", { name: "Mine", query: "status=CONFIRMED", shared: true, permissions: ["MANAGE_REGISTRATION"] }), create);
    // An unknown body field is a bad request, so nothing reaches the repository.
    expect(mocks.createSavedView).not.toHaveBeenCalled();
    await POST(json("POST", { name: "Mine", query: "status=CONFIRMED", shared: true }), create);
    expect(mocks.createSavedView.mock.calls[0]![0].permissions).not.toContain("MANAGE_REGISTRATION");
  });
});

describe("a full list", () => {
  it("answers 409 when a person is at the limit", async () => {
    mocks.createSavedView.mockRejectedValueOnce(new mocks.SavedViewError("LIMIT_REACHED", "Full."));
    expect((await POST(json("POST", { name: "More", query: "status=CONFIRMED" }), create)).status).toBe(409);
  });
});
