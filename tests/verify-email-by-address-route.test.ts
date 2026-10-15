import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #554 slice (c): POST /api/attendee/verify-email/by-address at the route. Cross-origin
 * refusal, both 429 paths, one identical refusal for bad input and wrong codes, and the
 * session cookie flags on success. Synthetic data only.
 */

const mocks = vi.hoisted(() => ({
  rejectCrossOriginRequest: vi.fn(),
  clientLimit: vi.fn(),
  addressLimit: vi.fn(),
  verify: vi.fn(),
  cookieSet: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: vi.fn(), set: mocks.cookieSet, delete: vi.fn() }) }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/rate-limit/service", () => ({
  checkAttendeeVerificationRateLimit: mocks.clientLimit,
  checkAttendeeVerifyByAddressRateLimit: mocks.addressLimit,
}));
vi.mock("@/modules/attendee-accounts/account-service", () => ({ verifyAttendeeEmailByAddress: mocks.verify }));

import { POST } from "@/app/api/attendee/verify-email/by-address/route";

const allowed = { allowed: true, decisions: [] };
const blocked = { allowed: false, decisions: [{ policy: "x", allowed: false, limit: 5, remaining: 0, count: 6, windowSeconds: 900, resetAfterSeconds: 300 }] };

function post(body: unknown) {
  return new Request("https://events.imsda.test/api/attendee/verify-email/by-address", {
    method: "POST",
    headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function observable(response: Response) {
  const headers = Object.fromEntries([...response.headers.entries()].filter(([name]) => name !== "x-correlation-id"));
  return { status: response.status, headers, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.clientLimit.mockResolvedValue(allowed);
  mocks.addressLimit.mockResolvedValue(allowed);
  mocks.verify.mockResolvedValue({ outcome: "rejected" });
});

describe("POST /api/attendee/verify-email/by-address", () => {
  it("refuses a cross-origin request before doing anything", async () => {
    const refusal = Response.json({ error: "CROSS_ORIGIN" }, { status: 403 });
    mocks.rejectCrossOriginRequest.mockReturnValue(refusal);
    const response = await POST(post({ email: "person@example.test", code: "123456" }));
    expect(response).toBe(refusal);
    expect(mocks.clientLimit).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("answers 429 from the client limit before reading the body", async () => {
    mocks.clientLimit.mockResolvedValue(blocked);
    const response = await POST(post("not even json"));
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe("RATE_LIMITED");
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("answers 429 from the per-address limit without checking the code", async () => {
    mocks.addressLimit.mockResolvedValue(blocked);
    const response = await POST(post({ email: "person@example.test", code: "123456" }));
    expect(response.status).toBe(429);
    expect(mocks.addressLimit).toHaveBeenCalledWith(expect.any(Request), "person@example.test");
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("gives one identical refusal for bad input and for wrong, unknown or ineligible codes", async () => {
    const bodies: unknown[] = [
      "not json",
      {},
      { email: "not-an-email", code: "123456" },
      { email: "person@example.test" },
      { email: "person@example.test", code: "" },
      { email: "person@example.test", code: "x".repeat(40) },
      { email: "person@example.test", code: "000000" },
      { email: "nobody@example.test", code: "123456" },
    ];
    const seen = [];
    for (const body of bodies) seen.push(await observable(await POST(post(body))));
    expect(seen[0].status).toBe(400);
    expect(seen[0].body.error).toBe("INVALID_CODE");
    for (const result of seen) expect(result).toEqual(seen[0]);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("on success sets the attendee session cookie with the secure flags and answers ok", async () => {
    const expiresAt = new Date(Date.now() + 14 * 86_400_000);
    mocks.verify.mockResolvedValue({ outcome: "verified", accountId: "acct-1", session: { token: "session-token-value", expiresAt } });
    const response = await POST(post({ email: " Person@Example.Test ", code: "123 456" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    // The address is trimmed by the schema and whitespace is removed from the code.
    expect(mocks.verify).toHaveBeenCalledWith(expect.objectContaining({ email: "Person@Example.Test", code: "123456" }));
    expect(mocks.cookieSet).toHaveBeenCalledTimes(1);
    const [name, value, options] = mocks.cookieSet.mock.calls[0];
    expect(name).toBe("imsda_attendee_session");
    expect(value).toBe("session-token-value");
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
      maxAge: 14 * 24 * 60 * 60,
      priority: "high",
    });
  });

  it("marks the cookie secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      mocks.verify.mockResolvedValue({ outcome: "verified", accountId: "acct-1", session: { token: "t", expiresAt: new Date(Date.now() + 1000) } });
      await POST(post({ email: "person@example.test", code: "123456" }));
      expect(mocks.cookieSet.mock.calls[0][2].secure).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
