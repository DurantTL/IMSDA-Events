import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  update: vi.fn(),
  get: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/system-admin/platform-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/system-admin/platform-settings")>()),
  updatePlatformSettings: mocks.update,
  getPlatformSettings: mocks.get,
}));

import { PATCH } from "@/app/api/admin/platform-settings/route";
import { PlatformSettingsError } from "@/modules/system-admin/platform-settings";

const body = { organizationName: "IMSDA", defaultTimezone: "America/Chicago", defaultAttendeeEditPolicy: "TIERED", baseline: { organizationName: "Old" } };
const request = (payload: unknown) => new Request("http://localhost/api/admin/platform-settings", { method: "PATCH", body: JSON.stringify(payload) });

describe("PATCH /api/admin/platform-settings conflicts (#1076)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
  });

  it("returns 409 with the changed fields and the latest settings", async () => {
    mocks.update.mockRejectedValue(new PlatformSettingsError("PLATFORM_SETTINGS_CONFLICT", "Someone else saved.", ["organizationName"]));
    mocks.get.mockResolvedValue({ organizationName: "Newer" });
    const response = await (PATCH as unknown as (request: Request) => Promise<Response>)(request(body));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "PLATFORM_SETTINGS_CONFLICT",
      message: "Someone else saved.",
      fields: ["organizationName"],
      settings: { organizationName: "Newer" },
    });
  });

  it("passes the baseline through to the update and still returns the saved settings", async () => {
    mocks.update.mockResolvedValue({ organizationName: "IMSDA" });
    const response = await (PATCH as unknown as (request: Request) => Promise<Response>)(request(body));
    expect(response.status).toBe(200);
    expect(mocks.update.mock.calls[0][0].baseline).toEqual({ organizationName: "Old" });
  });
});
