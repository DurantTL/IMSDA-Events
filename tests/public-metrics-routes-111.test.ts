import { ZodError } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #111: which sign-in steps are counted, and as what. Each route's own collaborators are faked; the count helper is a
 * spy. A password step that hands off to two-step verification counts nothing; the passkey failure counts only when the
 * passkey itself fails. Synthetic data only.
 */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  authenticateWithPassword: vi.fn(),
  issueMfaChallenge: vi.fn(),
  completeMfaChallenge: vi.fn(),
  unifiedPasswordSignIn: vi.fn(),
  finishPasskeySignIn: vi.fn(),
  finishCombinedPasskeySignIn: vi.fn(),
  finishAttendeePasskeySignIn: vi.fn(),
  set: vi.fn(),
  cookieGet: vi.fn(() => ({ value: "handle" })),
}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/public-metrics/record", () => ({ countPublicMetric: mocks.count }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.set, get: mocks.cookieGet, delete: vi.fn() }) }));
vi.mock("@/modules/rate-limit/service", () => {
  const allowed = async () => ({ allowed: true, decisions: [] });
  return {
    checkLoginClientRateLimit: allowed, checkLoginAccountRateLimit: allowed, checkAttendeeSignInRateLimit: allowed,
    checkStaffPasskeySignInRateLimit: allowed, checkAttendeePasskeySignInRateLimit: allowed,
  };
});
vi.mock("@/modules/access/auth-service", () => ({ authenticateWithPassword: mocks.authenticateWithPassword }));
vi.mock("@/modules/access/mfa-service", () => {
  class MfaError extends Error { constructor(public readonly code: string, message: string) { super(message); } }
  return { MfaError, issueMfaChallenge: mocks.issueMfaChallenge, completeMfaChallenge: mocks.completeMfaChallenge, beginEnrollmentFromChallenge: vi.fn(), describeMfaChallenge: vi.fn(async () => { throw new MfaError("MFA_CHALLENGE_INVALID", "No."); }) };
});
vi.mock("@/modules/access/post-login-destination", () => ({ resolvePostLoginDestination: async () => "/overview" }));
vi.mock("@/modules/account-merge/account-link", () => ({ isUnifiedSignInEnabled: async () => true }));
vi.mock("@/modules/account-merge/unified-sign-in", () => ({ unifiedPasswordSignIn: mocks.unifiedPasswordSignIn, issueLinkedAttendeeSession: async () => null }));
vi.mock("@/modules/access/passkeys", async (importOriginal) => ({ ...(await importOriginal<object>()), finishPasskeySignIn: mocks.finishPasskeySignIn }));
vi.mock("@/modules/attendee-accounts/passkeys", async (importOriginal) => ({ ...(await importOriginal<object>()), finishPasskeySignIn: mocks.finishAttendeePasskeySignIn }));
vi.mock("@/modules/account-merge/combined-passkey-sign-in", () => ({ finishCombinedPasskeySignIn: mocks.finishCombinedPasskeySignIn }));

import { POST as staffLogin } from "@/app/api/auth/login/route";
import { POST as mfaChallenge } from "@/app/api/auth/mfa/challenge/route";
import { POST as unifiedSignIn } from "@/app/api/sign-in/route";
import { POST as staffPasskey } from "@/app/api/auth/passkeys/sign-in/route";
import { POST as unifiedPasskey } from "@/app/api/sign-in/passkey/route";
import { POST as attendeePasskey } from "@/app/api/attendee/passkeys/sign-in/route";
import { PasskeyError as AttendeePasskeyError } from "@/modules/attendee-accounts/passkeys";
import { MfaError } from "@/modules/access/mfa-service";
import { PasskeyError } from "@/modules/access/passkeys";

const post = (url: string, body: unknown) => new Request(`https://events.imsda.test${url}`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://events.imsda.test", "user-agent": "Synthetic Browser/1.0" },
  body: JSON.stringify(body),
});
const session = { token: "t", expiresAt: new Date("2026-11-28T00:00:00Z") };
const counted = () => mocks.count.mock.calls.map(([, metric, dimension]) => `${metric}:${dimension}`);
const passkeyBody = { response: { id: "x", rawId: "x", type: "public-key", response: { clientDataJSON: "x", authenticatorData: "x", signature: "x" }, clientExtensionResults: {} } };

beforeEach(() => vi.clearAllMocks());

describe("staff password sign-in", () => {
  const attempt = () => staffLogin(post("/api/auth/login", { email: "staff@imsda-events.test", password: "synthetic-password" }));

  it("counts a refusal as a failure and a direct sign-in as a success", async () => {
    mocks.authenticateWithPassword.mockResolvedValueOnce(null);
    expect((await attempt()).status).toBe(401);
    mocks.authenticateWithPassword.mockResolvedValueOnce({ outcome: "session", session, userId: "u1", globalRole: null });
    expect((await attempt()).status).toBe(200);
    expect(counted()).toEqual(["LOGIN_FAILURE:staff-password", "LOGIN_SUCCESS:staff-password"]);
  });

  it("counts nothing when the password step hands off to two-step verification or a passkey", async () => {
    mocks.authenticateWithPassword.mockResolvedValueOnce({ outcome: "mfa", userId: "u1", gate: "REQUIRED" });
    mocks.issueMfaChallenge.mockResolvedValue({ challengeToken: "c".repeat(40), expiresAt: new Date("2026-10-28T16:00:00Z") });
    expect((await attempt()).status).toBe(200);
    mocks.authenticateWithPassword.mockResolvedValueOnce({ outcome: "passkey_required" });
    expect((await attempt()).status).toBe(403);
    expect(mocks.count).not.toHaveBeenCalled();
  });
});

describe("two-step verification", () => {
  const verify = () => mfaChallenge(post("/api/auth/mfa/challenge", { challengeToken: "c".repeat(40), action: "verify", code: "123456" }));

  it("counts the sign-in as worked only when the code is accepted, and as failed when it is refused", async () => {
    mocks.completeMfaChallenge.mockResolvedValueOnce({ session, userId: "u1", globalRole: null, usedRecoveryCode: false, recoveryCodes: null });
    expect((await verify()).status).toBe(200);
    mocks.completeMfaChallenge.mockRejectedValueOnce(new MfaError("MFA_CODE_INVALID", "That code is wrong."));
    expect((await verify()).status).toBe(400);
    expect(counted()).toEqual(["LOGIN_SUCCESS:staff-mfa", "LOGIN_FAILURE:staff-mfa"]);
  });

  it("does not count a failed look-up of the challenge as a failed sign-in", async () => {
    const response = await mfaChallenge(post("/api/auth/mfa/challenge", { challengeToken: "c".repeat(40), action: "describe" }));
    expect(response.status).toBe(401);
    expect(mocks.count).not.toHaveBeenCalled();
  });
});

describe("unified sign-in", () => {
  const attempt = () => unifiedSignIn(post("/api/sign-in", { email: "visitor@imsda-events.test", password: "synthetic-password" }));

  it("counts a refusal and a sign-in by the unified method, and nothing for the hand-off to two-step verification", async () => {
    mocks.unifiedPasswordSignIn.mockResolvedValueOnce({ kind: "refused" });
    expect((await attempt()).status).toBe(401);
    mocks.unifiedPasswordSignIn.mockResolvedValueOnce({ kind: "mfa", userId: "u1", gate: "REQUIRED" });
    mocks.issueMfaChallenge.mockResolvedValue({ challengeToken: "c".repeat(40), expiresAt: new Date("2026-10-28T16:00:00Z") });
    expect((await attempt()).status).toBe(200);
    mocks.unifiedPasswordSignIn.mockResolvedValueOnce({ kind: "signed_in", staff: null, attendee: { session } });
    expect((await attempt()).status).toBe(200);
    expect(counted()).toEqual(["LOGIN_FAILURE:unified-password", "LOGIN_SUCCESS:unified-password"]);
  });
});

describe("passkey sign-in", () => {
  it("counts a staff passkey failure only when verification fails, not for a malformed request or a server error", async () => {
    const attempt = () => staffPasskey(post("/api/auth/passkeys/sign-in", passkeyBody));
    mocks.finishPasskeySignIn.mockRejectedValueOnce(new PasskeyError("PASSKEY_NOT_VERIFIED", "That passkey could not be verified."));
    await attempt();
    expect(counted()).toEqual(["LOGIN_FAILURE:staff-passkey"]);
    mocks.count.mockClear();
    mocks.finishPasskeySignIn.mockRejectedValueOnce(new Error("store down"));
    expect((await attempt()).status).toBe(500);
    expect((await staffPasskey(post("/api/auth/passkeys/sign-in", { nope: true }))).status).toBe(400);
    expect(mocks.count).not.toHaveBeenCalled();
    mocks.finishPasskeySignIn.mockResolvedValueOnce({ session, userId: "u1", globalRole: null });
    expect((await attempt()).status).toBe(200);
    expect(counted()).toEqual(["LOGIN_SUCCESS:staff-passkey"]);
  });

  it("counts the unified passkey by its own method, for either kind of account", async () => {
    const attempt = () => unifiedPasskey(post("/api/sign-in/passkey", passkeyBody));
    mocks.finishCombinedPasskeySignIn.mockRejectedValueOnce(new PasskeyError("PASSKEY_NOT_VERIFIED", "That passkey could not be verified."));
    await attempt();
    mocks.finishCombinedPasskeySignIn.mockRejectedValueOnce(new ZodError([]));
    await attempt();
    mocks.finishCombinedPasskeySignIn.mockResolvedValueOnce({ kind: "attendee", session });
    expect((await attempt()).status).toBe(200);
    mocks.finishCombinedPasskeySignIn.mockResolvedValueOnce({ kind: "staff", session, userId: "u1", globalRole: null });
    expect((await attempt()).status).toBe(200);
    expect(counted()).toEqual(["LOGIN_FAILURE:unified-passkey", "LOGIN_SUCCESS:unified-passkey", "LOGIN_SUCCESS:unified-passkey"]);
  });

  it("counts a failure only when the passkey was not verified, not for an expired prompt or an unavailable feature", async () => {
    const staff = () => staffPasskey(post("/api/auth/passkeys/sign-in", passkeyBody));
    const attendee = () => attendeePasskey(post("/api/attendee/passkeys/sign-in", passkeyBody));
    const unified = () => unifiedPasskey(post("/api/sign-in/passkey", passkeyBody));
    for (const code of ["CHALLENGE_EXPIRED", "PASSKEYS_NOT_AVAILABLE"] as const) {
      mocks.finishPasskeySignIn.mockRejectedValueOnce(new PasskeyError(code, "No."));
      mocks.finishAttendeePasskeySignIn.mockRejectedValueOnce(new AttendeePasskeyError(code, "No."));
      mocks.finishCombinedPasskeySignIn.mockRejectedValueOnce(new PasskeyError(code, "No."));
      await staff(); await attendee(); await unified();
    }
    expect(mocks.count).not.toHaveBeenCalled();
    mocks.finishAttendeePasskeySignIn.mockRejectedValueOnce(new AttendeePasskeyError("PASSKEY_NOT_VERIFIED", "No."));
    await attendee();
    mocks.finishAttendeePasskeySignIn.mockResolvedValueOnce({ session });
    expect((await attendee()).status).toBe(200);
    expect(counted()).toEqual(["LOGIN_FAILURE:attendee-passkey", "LOGIN_SUCCESS:attendee-passkey"]);
  });
});
