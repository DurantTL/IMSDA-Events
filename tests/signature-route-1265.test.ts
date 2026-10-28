import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => {
  class MockAccessDeniedError extends Error {
    constructor(message: string, public readonly code = "PERMISSION_DENIED", public readonly status = 403) {
      super(message);
    }
  }
  return {
    MockAccessDeniedError,
    requirePermission: vi.fn(),
    getCurrentSession: vi.fn(),
    findActiveMembership: vi.fn(),
    listRegistrationSignatures: vi.fn(),
    logError: vi.fn(),
  };
});

vi.mock("@/modules/access/authorization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/access/authorization")>()),
  requirePermission: dependencies.requirePermission,
  AccessDeniedError: dependencies.MockAccessDeniedError,
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: dependencies.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: dependencies.findActiveMembership }));
vi.mock("@/lib/logger", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/logger")>()), logError: dependencies.logError }));
vi.mock("@/modules/signatures/repository", () => ({ listRegistrationSignatures: dependencies.listRegistrationSignatures }));

import { GET } from "@/app/api/events/[eventId]/registrations/[registrationId]/signatures/route";

const params = Promise.resolve({ eventId: "event-1", registrationId: "reg-1" });
const request = () => new Request("http://localhost/api");
const user = { id: "user-1", globalRole: "USER" };

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.getCurrentSession.mockResolvedValue({ user });
  dependencies.listRegistrationSignatures.mockResolvedValue({ canViewRecord: false, signatures: [] });
});

describe("the staff signatures route (#1265)", () => {
  it("needs MANAGE_REGISTRATION on the event in the URL and is not cached", async () => {
    dependencies.requirePermission.mockResolvedValue({ user, membership: { role: "REGISTRATION_MANAGER", permissions: [], status: "ACTIVE" } });
    const response = await GET(request(), { params });
    expect(response.status).toBe(200);
    expect(dependencies.requirePermission).toHaveBeenCalledWith(expect.anything(), "event-1", "MANAGE_REGISTRATION", dependencies.findActiveMembership);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("asks the repository for the full record when the role carries VIEW_SENSITIVE_DATA", async () => {
    dependencies.requirePermission.mockResolvedValue({ user, membership: { role: "REGISTRATION_MANAGER", permissions: [], status: "ACTIVE" } });
    await GET(request(), { params });
    expect(dependencies.listRegistrationSignatures).toHaveBeenCalledWith("event-1", "reg-1", true);
  });

  it("asks for the summary only when the member lacks VIEW_SENSITIVE_DATA", async () => {
    dependencies.requirePermission.mockResolvedValue({ user, membership: { role: "READ_ONLY_STAFF", permissions: ["MANAGE_REGISTRATION"], status: "ACTIVE" } });
    await GET(request(), { params });
    expect(dependencies.listRegistrationSignatures).toHaveBeenCalledWith("event-1", "reg-1", false);
  });

  it("grants the full record to a system administrator", async () => {
    const admin = { id: "admin-1", globalRole: "SYSTEM_ADMIN" };
    dependencies.requirePermission.mockResolvedValue({ user: admin, membership: null });
    await GET(request(), { params });
    expect(dependencies.listRegistrationSignatures).toHaveBeenCalledWith("event-1", "reg-1", true);
  });

  it("refuses someone without access and answers 404 for another event's registration", async () => {
    dependencies.requirePermission.mockRejectedValue(new dependencies.MockAccessDeniedError("The MANAGE_REGISTRATION permission is required for this event."));
    expect((await GET(request(), { params })).status).toBe(403);
    expect(dependencies.listRegistrationSignatures).not.toHaveBeenCalled();
    dependencies.requirePermission.mockResolvedValue({ user, membership: { role: "REGISTRATION_MANAGER", permissions: [], status: "ACTIVE" } });
    dependencies.listRegistrationSignatures.mockResolvedValue(null);
    expect((await GET(request(), { params })).status).toBe(404);
  });
});
