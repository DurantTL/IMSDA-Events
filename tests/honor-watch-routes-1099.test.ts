import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks, AccessDenied, WatchError } = vi.hoisted(() => {
  class Denied extends Error {
    constructor(message: string, readonly status: number, readonly code: string) {
      super(message);
    }
  }
  class WError extends Error {
    constructor(message: string, readonly code: string) {
      super(message);
    }
  }
  return {
    AccessDenied: Denied,
    WatchError: WError,
    mocks: { requirePermission: vi.fn(), getPanel: vi.fn(), replace: vi.fn() },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn() }));
vi.mock("@/modules/access/authorization", () => ({ AccessDeniedError: AccessDenied }));
vi.mock("@/modules/honors/access", () => ({ requireHonorPermission: mocks.requirePermission }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: (request: Request) => (request.headers.get("origin") === "https://evil.example" ? Response.json({}, { status: 403 }) : null) }));
vi.mock("@/modules/honors/watch-repository", () => ({
  HonorWatchError: WatchError,
  getHonorWatchPanel: mocks.getPanel,
  replaceHonorWatches: mocks.replace,
}));

import { GET, PUT } from "@/app/api/events/[eventId]/honors/watches/route";
import { rolePermissions } from "@/modules/access/permissions";

/** Who may edit an event's honor watches (#1099): event administrators and system administrators, checked on the server. */

const context = { params: Promise.resolve({ eventId: "event-1" }) };
const put = (body: unknown, headers: Record<string, string> = {}) => new Request("http://localhost/x", { method: "PUT", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePermission.mockResolvedValue({ user: { id: "admin-1" } });
  mocks.getPanel.mockResolvedValue({ watches: [], classes: [] });
  mocks.replace.mockResolvedValue({ watches: [], classes: [] });
});

describe("honor watch routes (#1099)", () => {
  it("require the event-configuration permission for reading and saving", async () => {
    await GET(new Request("http://localhost/x"), context);
    await PUT(put({ watches: [] }), context);
    expect(mocks.requirePermission).toHaveBeenCalledTimes(2);
    for (const call of mocks.requirePermission.mock.calls) expect(call).toEqual(["event-1", "CONFIGURE_EVENT"]);
  });

  it("only the event administrator role carries it, so no other event role is let in", () => {
    expect(rolePermissions.EVENT_ADMIN).toContain("CONFIGURE_EVENT");
    for (const role of ["REGISTRATION_MANAGER", "FINANCE_MANAGER", "COMMUNICATIONS_MANAGER", "CHECK_IN_STAFF", "READ_ONLY_STAFF", "KITCHEN_STAFF"] as const) {
      expect(rolePermissions[role], role).not.toContain("CONFIGURE_EVENT");
    }
  });

  it("refuses without touching the data when the permission check fails", async () => {
    mocks.requirePermission.mockRejectedValue(new AccessDenied("The CONFIGURE_EVENT permission is required for this event.", 403, "PERMISSION_DENIED"));
    const read = await GET(new Request("http://localhost/x"), context);
    const write = await PUT(put({ watches: [] }), context);
    expect(read.status).toBe(403);
    expect(write.status).toBe(403);
    expect(mocks.getPanel).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin save before any check", async () => {
    const response = await PUT(put({ watches: [] }, { origin: "https://evil.example" }), context);
    expect(response.status).toBe(403);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("saves as the signed-in administrator and returns the panel with no caching", async () => {
    const response = await PUT(put({ watches: [{ name: "Nature", recipients: ["a@example.test"], honorIds: ["h1"], offeringIds: [] }] }), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.replace).toHaveBeenCalledWith("event-1", "admin-1", { watches: [{ name: "Nature", recipients: ["a@example.test"], honorIds: ["h1"], offeringIds: [] }] });
  });

  it("answers a validation problem with 400 and its message, and an unreadable body the same way", async () => {
    mocks.replace.mockRejectedValue(new WatchError("Watch 1: add at least one email address.", "INVALID_WATCHES"));
    const bad = await PUT(put({ watches: [] }), context);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "INVALID_WATCHES", message: "Watch 1: add at least one email address." });
    const unreadable = await PUT(new Request("http://localhost/x", { method: "PUT", headers: { "content-type": "application/json" }, body: "not json" }), context);
    expect(unreadable.status).toBe(400);
    expect(mocks.replace).toHaveBeenLastCalledWith("event-1", "admin-1", null);
  });

  it("answers an unknown event with 404 and an unexpected failure with a generic 500", async () => {
    mocks.replace.mockRejectedValueOnce(new WatchError("That event could not be found.", "EVENT_NOT_FOUND"));
    expect((await PUT(put({ watches: [] }), context)).status).toBe(404);
    mocks.replace.mockRejectedValueOnce(new Error("boom: secret detail"));
    const failed = await PUT(put({ watches: [] }), context);
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain("secret detail");
  });
});
