import { beforeEach, describe, expect, it, vi } from "vitest";

/** #111: the attendee sign-in route counts worked/failed by method only and answers exactly as before. Synthetic data only. */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  authenticateAttendee: vi.fn(),
  recordPublicMetric: vi.fn(),
  set: vi.fn(),
}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.set }) }));
vi.mock("@/modules/attendee-accounts/account-service", () => ({ authenticateAttendee: mocks.authenticateAttendee }));
vi.mock("@/modules/rate-limit/service", () => ({ checkAttendeeSignInRateLimit: async () => ({ allowed: true, decisions: [] }) }));
vi.mock("@/modules/public-metrics/repository", () => ({ recordPublicMetric: mocks.recordPublicMetric }));
vi.mock("next/server", () => ({ after: () => { throw new Error("outside a request"); } }));

import { POST } from "@/app/api/attendee/sign-in/route";

const attempt = () => POST(new Request("https://events.imsda.test/api/attendee/sign-in", {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://events.imsda.test", "user-agent": "Synthetic Browser/1.0" },
  body: JSON.stringify({ email: "visitor@imsda-events.test", password: "synthetic-password" }),
}));

beforeEach(() => vi.clearAllMocks());

describe("sign-in counts (#111)", () => {
  it("records a refusal as a failure by method only, and still answers 401 in the same words", async () => {
    mocks.authenticateAttendee.mockResolvedValue(null);
    const response = await attempt();
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "INVALID_CREDENTIALS" });
    expect(mocks.recordPublicMetric).toHaveBeenCalledTimes(1);
    expect(mocks.recordPublicMetric.mock.calls[0]).toEqual(["LOGIN_FAILURE", "attendee-password"]);
  });

  it("records a sign-in as a success by method only, and still sets the session cookie", async () => {
    mocks.authenticateAttendee.mockResolvedValue({ session: { token: "t", expiresAt: new Date("2026-11-28T00:00:00Z") } });
    const response = await attempt();
    expect(response.status).toBe(200);
    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(mocks.recordPublicMetric.mock.calls).toEqual([["LOGIN_SUCCESS", "attendee-password"]]);
    expect(JSON.stringify(mocks.recordPublicMetric.mock.calls)).not.toMatch(/visitor|synthetic/i);
  });

  it("answers exactly the same when the count itself fails", async () => {
    mocks.recordPublicMetric.mockRejectedValue(new Error("db down"));
    mocks.authenticateAttendee.mockResolvedValue(null);
    const refused = await attempt();
    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({ error: "INVALID_CREDENTIALS" });
    mocks.authenticateAttendee.mockResolvedValue({ session: { token: "t", expiresAt: new Date("2026-11-28T00:00:00Z") } });
    expect((await attempt()).status).toBe(200);
  });

  it("counts nothing when the browser sends Global Privacy Control", async () => {
    mocks.authenticateAttendee.mockResolvedValue(null);
    await POST(new Request("https://events.imsda.test/api/attendee/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://events.imsda.test", "sec-gpc": "1" },
      body: JSON.stringify({ email: "visitor@imsda-events.test", password: "synthetic-password" }),
    }));
    expect(mocks.recordPublicMetric).not.toHaveBeenCalled();
  });
});
