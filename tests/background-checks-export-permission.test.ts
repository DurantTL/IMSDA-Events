import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  AccessDeniedError: class extends Error {
    constructor(message: string, public readonly status = 403, public readonly code = "PERMISSION_DENIED") {
      super(message);
    }
  },
  requirePermission: vi.fn(),
  getCurrentSession: vi.fn(),
  listEventBackgroundFlags: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/authorization", () => ({
  AccessDeniedError: mocks.AccessDeniedError,
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: vi.fn() }));
vi.mock("@/modules/background-checks/repository", () => ({ listEventBackgroundFlags: mocks.listEventBackgroundFlags }));
vi.mock("@/modules/reporting/export-scope", () => ({ eventFileScope: vi.fn().mockResolvedValue("event") }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));

import { GET } from "@/app/api/events/[eventId]/background-checks/route";

const context = { params: Promise.resolve({ eventId: "event-1" }) };

describe("Sterling Volunteers contact list download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.listEventBackgroundFlags.mockResolvedValue({ people: [] });
  });

  it("is refused without the sensitive-data permission, and reads nothing", async () => {
    mocks.requirePermission.mockImplementation(async (_session: unknown, _event: string, permission: string) => {
      if (permission === "VIEW_SENSITIVE_DATA") throw new mocks.AccessDeniedError("denied");
      return { user: { id: "user-1" } };
    });
    const response = await GET(new Request("http://localhost/x"), context);
    expect(response.status).toBe(403);
    expect(mocks.listEventBackgroundFlags).not.toHaveBeenCalled();
  });

  it("requires both report access and the sensitive-data permission", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "user-1" } });
    const response = await GET(new Request("http://localhost/x"), context);
    expect(response.status).toBe(200);
    const asked = mocks.requirePermission.mock.calls.map((call) => call[2]);
    expect(asked).toContain("VIEW_REPORTS");
    expect(asked).toContain("VIEW_SENSITIVE_DATA");
  });
});
