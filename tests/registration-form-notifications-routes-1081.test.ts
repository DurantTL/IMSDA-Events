import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks, AccessDenied, NotificationError } = vi.hoisted(() => {
  class Denied extends Error {
    constructor(message: string, readonly status: number, readonly code: string) {
      super(message);
    }
  }
  class NotifError extends Error {
    constructor(message: string, readonly code: string) {
      super(message);
    }
  }
  return {
    AccessDenied: Denied,
    NotificationError: NotifError,
    mocks: { requirePermission: vi.fn(), getPanel: vi.fn(), replace: vi.fn() },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn() }));
vi.mock("@/modules/access/authorization", () => ({ AccessDeniedError: AccessDenied, requirePermission: mocks.requirePermission }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: vi.fn().mockResolvedValue({}) }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: (request: Request) => (request.headers.get("origin") === "https://evil.example" ? Response.json({}, { status: 403 }) : null) }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: vi.fn() }));
vi.mock("@/modules/registration-form-notifications/repository", () => ({
  FormNotificationError: NotificationError,
  getFormNotificationsPanel: mocks.getPanel,
  replaceFormNotifications: mocks.replace,
}));

import { GET, PUT } from "@/app/api/events/[eventId]/forms/[formId]/notifications/route";
import { rolePermissions } from "@/modules/access/permissions";

/** Who may edit a form's notifications (#1081): event administrators and system administrators, checked on the server. */

const context = { params: Promise.resolve({ eventId: "event-1", formId: "form-1" }) };
const put = (body: unknown, headers: Record<string, string> = {}) => new Request("http://localhost/x", { method: "PUT", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePermission.mockResolvedValue({ user: { id: "admin-1" } });
  mocks.getPanel.mockResolvedValue({ notifications: [], fields: [], sections: [], locations: [] });
  mocks.replace.mockResolvedValue({ notifications: [], fields: [], sections: [], locations: [] });
});

describe("registration form notification routes (#1081)", () => {
  it("require the event-configuration permission for reading and saving", async () => {
    await GET(new Request("http://localhost/x"), context);
    await PUT(put({ notifications: [] }), context);
    expect(mocks.requirePermission).toHaveBeenCalledTimes(2);
    for (const call of mocks.requirePermission.mock.calls) expect(call[2]).toBe("CONFIGURE_EVENT");
  });

  it("only the event administrator role carries it, so a registration or communications manager is refused", () => {
    expect(rolePermissions.EVENT_ADMIN).toContain("CONFIGURE_EVENT");
    for (const role of ["REGISTRATION_MANAGER", "FINANCE_MANAGER", "COMMUNICATIONS_MANAGER", "CHECK_IN_STAFF", "READ_ONLY_STAFF", "KITCHEN_STAFF"] as const) {
      expect(rolePermissions[role], role).not.toContain("CONFIGURE_EVENT");
    }
  });

  it("refuses without touching the data when the permission check fails", async () => {
    mocks.requirePermission.mockRejectedValue(new AccessDenied("The CONFIGURE_EVENT permission is required for this event.", 403, "PERMISSION_DENIED"));
    const read = await GET(new Request("http://localhost/x"), context);
    const write = await PUT(put({ notifications: [] }), context);
    expect(read.status).toBe(403);
    expect(write.status).toBe(403);
    expect(mocks.getPanel).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin save before any check", async () => {
    const response = await PUT(put({ notifications: [] }, { origin: "https://evil.example" }), context);
    expect(response.status).toBe(403);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("saves as the signed-in user with no-store headers, and reports a bad list as 400", async () => {
    const response = await PUT(put({ notifications: [{ name: "Camping coordinator" }] }), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.replace).toHaveBeenCalledWith("event-1", "form-1", "admin-1", { notifications: [{ name: "Camping coordinator" }] });
    mocks.replace.mockRejectedValue(new NotificationError("Notification 1: add at least one email address.", "INVALID_NOTIFICATIONS"));
    const bad = await PUT(put({ notifications: [] }), context);
    expect(bad.status).toBe(400);
    // An unknown or non-club organization id (#1097) is refused by the repository, and the route reports it as 400.
    mocks.replace.mockRejectedValue(new NotificationError("Notification 1: choose one of the clubs in the directory.", "INVALID_NOTIFICATIONS"));
    const unknownClub = await PUT(put({ notifications: [{ name: "Club", recipients: ["a@example.test"], condition: { fieldKey: "__club", operator: "EQUALS", value: "not-a-club" }, sectionIds: [] }] }), context);
    expect(unknownClub.status).toBe(400);
    expect((await unknownClub.json()).message).toContain("clubs in the directory");
    mocks.getPanel.mockRejectedValue(new NotificationError("That registration form was not found.", "FORM_NOT_FOUND"));
    expect((await GET(new Request("http://localhost/x"), context)).status).toBe(404);
  });
});
