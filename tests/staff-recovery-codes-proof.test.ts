import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwnStaffSession: vi.fn(),
  requireRecentVerification: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
  getCurrentSession: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/passkey-api", async () => {
  const actual = await vi.importActual<typeof import("@/modules/access/passkey-api")>("@/modules/access/passkey-api");
  return { ...actual, requireOwnStaffSession: mocks.requireOwnStaffSession };
});
vi.mock("@/modules/access/passkeys", () => ({
  requireRecentVerification: mocks.requireRecentVerification,
  PasskeyError: class PasskeyError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("@/modules/access/mfa-service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/access/mfa-service")>("@/modules/access/mfa-service");
  return { ...actual, regenerateRecoveryCodes: mocks.regenerateRecoveryCodes };
});

import { POST } from "@/app/api/auth/mfa/route";
import { PasskeyError } from "@/modules/access/passkeys";

const origin = "https://events.imsda.test";
const account = { id: "user-1", email: "staff@imsda.test", displayName: "Test Staff" };
const post = (body: unknown) => new Request(`${origin}/api/auth/mfa`, {
  method: "POST",
  headers: { origin, "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-1" } });
  mocks.requireOwnStaffSession.mockResolvedValue({ account, sessionId: "session-1" });
  mocks.regenerateRecoveryCodes.mockResolvedValue({ recoveryCodes: ["11111-22222"] });
});

describe("issuing new recovery codes to a signed-in staff member", () => {
  it("is refused without a fresh proof, and changes nothing", async () => {
    mocks.requireRecentVerification.mockRejectedValue(new PasskeyError("RECENT_VERIFICATION_REQUIRED", "Confirm it's you first."));
    const response = await POST(post({ action: "regenerate-recovery-codes" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "RECENT_VERIFICATION_REQUIRED" });
    expect(mocks.requireRecentVerification).toHaveBeenCalledWith(account, "session-1", origin, undefined);
    expect(mocks.regenerateRecoveryCodes).not.toHaveBeenCalled();
  });

  it("issues the codes once the proof is accepted", async () => {
    mocks.requireRecentVerification.mockResolvedValue(undefined);
    const response = await POST(post({ action: "regenerate-recovery-codes", proof: { code: "123456" } }));
    expect(response.status).toBe(200);
    expect(mocks.requireRecentVerification).toHaveBeenCalledWith(account, "session-1", origin, expect.objectContaining({ code: "123456" }));
    expect(mocks.regenerateRecoveryCodes).toHaveBeenCalledWith("user-1");
  });
});
