import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The emailed sign-in code routes (#1410): rate limits first, refusal shapes, no code in any response, and
 * two-step setup refused while the code is still owed. Synthetic data only.
 */

const mocks = vi.hoisted(() => ({
  getCurrentAttendee: vi.fn(),
  accountNeedsSignInStep: vi.fn(),
  issueSignInCode: vi.fn(),
  verifyAttendeeSignInCode: vi.fn(),
  checkVerifyRateLimit: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  startSignInCodeIfRequired: vi.fn(),
  authenticateAttendee: vi.fn(),
  unifiedPasswordSignIn: vi.fn(),
  logError: vi.fn(),
  beginEnrollment: vi.fn(),
  finishPasskeyRegistration: vi.fn(),
  cookieSet: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/lib/logger", () => ({ logError: mocks.logError, logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.cookieSet }) }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSignInStep: mocks.accountNeedsSignInStep }));
vi.mock("@/modules/attendee-accounts/sign-in-code-issue", () => ({
  issueSignInCode: mocks.issueSignInCode,
  startSignInCodeIfRequired: mocks.startSignInCodeIfRequired,
}));
vi.mock("@/modules/attendee-accounts/sign-in-code-service", () => ({ verifyAttendeeSignInCode: mocks.verifyAttendeeSignInCode }));
vi.mock("@/modules/rate-limit/service", () => ({
  checkAttendeeSignInCodeVerifyRateLimit: mocks.checkVerifyRateLimit,
  checkAttendeeSignInRateLimit: async () => ({ allowed: true, decisions: [] }),
  checkLoginClientRateLimit: async () => ({ allowed: true, decisions: [] }),
  checkLoginAccountRateLimit: async () => ({ allowed: true, decisions: [] }),
}));
vi.mock("@/modules/attendee-accounts/account-service", () => ({ authenticateAttendee: mocks.authenticateAttendee }));
vi.mock("@/modules/account-merge/account-link", () => ({ isUnifiedSignInEnabled: async () => true }));
vi.mock("@/modules/account-merge/unified-sign-in", () => ({ unifiedPasswordSignIn: mocks.unifiedPasswordSignIn }));
vi.mock("@/modules/public-metrics/record", () => ({ countPublicMetric: vi.fn() }));
vi.mock("@/modules/access/post-login-destination", () => ({ resolvePostLoginDestination: async () => "/" }));
vi.mock("@/modules/access/mfa-service", () => ({ issueMfaChallenge: vi.fn() }));
vi.mock("@/modules/club-rosters/access", () => ({ markRosterUnlocked: vi.fn() }));
vi.mock("@/modules/attendee-accounts/mfa-service", () => ({
  AttendeeMfaError: class extends Error {},
  beginAttendeeMfaEnrollment: mocks.beginEnrollment,
  confirmAttendeeMfaEnrollment: vi.fn(),
  disableAttendeeMfa: vi.fn(),
  getAttendeeMfaStatus: vi.fn(),
  regenerateAttendeeRecoveryCodes: vi.fn(),
}));
vi.mock("@/modules/attendee-accounts/passkeys", async () => {
  const actual = await vi.importActual<typeof import("@/modules/attendee-accounts/passkeys")>("@/modules/attendee-accounts/passkeys");
  return { ...actual, finishPasskeyRegistration: mocks.finishPasskeyRegistration };
});

import { POST as VERIFY } from "@/app/api/attendee/sign-in-code/verify/route";
import { POST as SEND } from "@/app/api/attendee/sign-in-code/send/route";
import { POST as ATTENDEE_SIGN_IN } from "@/app/api/attendee/sign-in/route";
import { POST as UNIFIED_SIGN_IN } from "@/app/api/sign-in/route";
import { POST as MFA } from "@/app/api/attendee/mfa/route";
import { POST as PASSKEY_REGISTRATION } from "@/app/api/attendee/passkeys/registration/route";

const ORIGIN = "https://events.imsda.test";
const account = { id: "account-1", verifiedEmail: "director@imsda-events.test", displayName: "Test Director" };
const SECRET_CODE = "518207";

const post = (path: string, body: unknown) => new Request(`${ORIGIN}${path}`, {
  method: "POST",
  headers: { origin: ORIGIN, "content-type": "application/json" },
  body: JSON.stringify(body),
});
const allowed = { allowed: true, decisions: [] };
const limited = { allowed: false, decisions: [{ policy: "attendee.sign-in-code-verify.account", allowed: false, limit: 10, remaining: 0, count: 11, windowSeconds: 900, resetAfterSeconds: 600 }] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.getCurrentAttendee.mockResolvedValue({ account, via: "attendee", sessionId: "session-1" });
  mocks.accountNeedsSignInStep.mockResolvedValue("EMAIL_CODE");
  mocks.checkVerifyRateLimit.mockResolvedValue(allowed);
  mocks.issueSignInCode.mockResolvedValue({ sent: true, rateLimited: false, rateLimit: allowed });
  mocks.verifyAttendeeSignInCode.mockResolvedValue({ ok: true, codeId: "code-1" });
});

describe("POST /api/attendee/sign-in-code/verify", () => {
  it("needs the person's own attendee session (a staff act-as has none)", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account, via: "staff", sessionId: null });
    const response = await VERIFY(post("/api/attendee/sign-in-code/verify", { code: SECRET_CODE }));
    expect(response.status).toBe(401);
    expect(mocks.verifyAttendeeSignInCode).not.toHaveBeenCalled();
  });

  it("spends the verify budget before reading or checking anything", async () => {
    mocks.checkVerifyRateLimit.mockResolvedValue(limited);
    const request = post("/api/attendee/sign-in-code/verify", { code: SECRET_CODE });
    const parse = vi.spyOn(request, "json");
    const response = await VERIFY(request);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "RATE_LIMITED", message: "Too many attempts. Wait a few minutes and try again." });
    expect(parse).not.toHaveBeenCalled();
    expect(mocks.verifyAttendeeSignInCode).not.toHaveBeenCalled();
  });

  it("is keyed to the account, and charged with the request for the client address", async () => {
    await VERIFY(post("/api/attendee/sign-in-code/verify", { code: SECRET_CODE }));
    expect(mocks.checkVerifyRateLimit).toHaveBeenCalledWith(expect.any(Request), "account-1");
  });

  it("checks the code for exactly this account and session, accepting a pasted '518 207'", async () => {
    const response = await VERIFY(post("/api/attendee/sign-in-code/verify", { code: "518 207" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.verifyAttendeeSignInCode).toHaveBeenCalledWith({ accountId: "account-1", sessionId: "session-1", code: "518 207" });
  });

  it("refuses what is not six digits without checking it", async () => {
    for (const code of ["12345", "1234567", "abcdef", "", "518-207"]) {
      const response = await VERIFY(post("/api/attendee/sign-in-code/verify", { code }));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("INVALID_CODE");
    }
    expect((await VERIFY(post("/api/attendee/sign-in-code/verify", { code: SECRET_CODE, extra: 1 }))).status).toBe(400);
    expect(mocks.verifyAttendeeSignInCode).not.toHaveBeenCalled();
  });

  it("answers a wrong code and a spent code in plain words, without the code, a hash or the attempts left", async () => {
    mocks.verifyAttendeeSignInCode.mockResolvedValueOnce({ ok: false, reason: "WRONG_CODE", attemptsLeft: 3 });
    const wrong = await VERIFY(post("/api/attendee/sign-in-code/verify", { code: "111111" }));
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: "INVALID_CODE", message: "That code didn't work. Check the latest email, or send a new code." });
    mocks.verifyAttendeeSignInCode.mockResolvedValueOnce({ ok: false, reason: "NO_LIVE_CODE" });
    const expired = await VERIFY(post("/api/attendee/sign-in-code/verify", { code: "111111" }));
    expect(expired.status).toBe(400);
    expect(await expired.json()).toEqual({ error: "CODE_EXPIRED", message: "That code has expired or was already used. Send a new code." });
  });

  it("checks nothing for a session that owes no code", async () => {
    mocks.accountNeedsSignInStep.mockResolvedValue("OK");
    const response = await VERIFY(post("/api/attendee/sign-in-code/verify", { code: SECRET_CODE }));
    expect(response.status).toBe(200);
    expect(mocks.verifyAttendeeSignInCode).not.toHaveBeenCalled();
  });

  it("never logs the submitted code when something fails", async () => {
    mocks.verifyAttendeeSignInCode.mockRejectedValue(new Error("database down"));
    const response = await VERIFY(post("/api/attendee/sign-in-code/verify", { code: SECRET_CODE }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain(SECRET_CODE);
    expect(JSON.stringify(await response.json())).not.toContain(SECRET_CODE);
  });
});

describe("POST /api/attendee/sign-in-code/send", () => {
  it("needs the person's own attendee session", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect((await SEND(post("/api/attendee/sign-in-code/send", {}))).status).toBe(401);
    expect(mocks.issueSignInCode).not.toHaveBeenCalled();
  });

  it("sends nothing to a session that owes no code", async () => {
    mocks.accountNeedsSignInStep.mockResolvedValue("OK");
    const response = await SEND(post("/api/attendee/sign-in-code/send", {}));
    expect(await response.json()).toEqual({ ok: true, required: false });
    expect(mocks.issueSignInCode).not.toHaveBeenCalled();
  });

  it("sends a new code for this session and returns no code", async () => {
    const response = await SEND(post("/api/attendee/sign-in-code/send", {}));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, required: true });
    expect(JSON.stringify(body)).not.toMatch(/\d{6}/);
    expect(mocks.issueSignInCode).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account-1", sessionId: "session-1", email: account.verifiedEmail }));
  });

  it("answers 429 when the send budget says no", async () => {
    mocks.issueSignInCode.mockResolvedValue({ sent: false, rateLimited: true, rateLimit: limited });
    const response = await SEND(post("/api/attendee/sign-in-code/send", {}));
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe("RATE_LIMITED");
  });
});

describe("sign-in routes", () => {
  const signInBody = { email: "director@imsda-events.test", password: "synthetic-password" };
  const authenticated = { accountId: "account-1", session: { token: "token-1", expiresAt: new Date("2027-01-01T00:00:00Z") } };

  it("a wrong password never reaches the code step, so nothing says whether the address is a club role", async () => {
    mocks.authenticateAttendee.mockResolvedValue(null);
    const response = await ATTENDEE_SIGN_IN(post("/api/attendee/sign-in", signInBody));
    expect(response.status).toBe(401);
    expect(mocks.startSignInCodeIfRequired).not.toHaveBeenCalled();
  });

  it("a club role gets the code sent and is told to go to step 2; the body carries no code", async () => {
    mocks.authenticateAttendee.mockResolvedValue(authenticated);
    mocks.startSignInCodeIfRequired.mockResolvedValue({ required: true, sent: true });
    const response = await ATTENDEE_SIGN_IN(post("/api/attendee/sign-in", signInBody));
    expect(await response.json()).toEqual({ ok: true, signInCode: { required: true, sent: true } });
    expect(mocks.startSignInCodeIfRequired).toHaveBeenCalledWith({ request: expect.any(Request), accountId: "account-1", sessionToken: "token-1" });
  });

  it("everyone else gets exactly today's body", async () => {
    mocks.authenticateAttendee.mockResolvedValue(authenticated);
    mocks.startSignInCodeIfRequired.mockResolvedValue({ required: false });
    const response = await ATTENDEE_SIGN_IN(post("/api/attendee/sign-in", signInBody));
    expect(await response.json()).toEqual({ ok: true });
  });

  it("the unified sign-in sends an attendee-only club role to the code page, carrying the way back", async () => {
    mocks.unifiedPasswordSignIn.mockResolvedValue({ kind: "signed_in", staff: null, attendee: authenticated });
    mocks.startSignInCodeIfRequired.mockResolvedValue({ required: true, sent: true });
    const response = await UNIFIED_SIGN_IN(post("/api/sign-in", { ...signInBody, next: "/account/clubs/club-1" }));
    expect(await response.json()).toEqual({
      ok: true,
      redirectTo: `/account/sign-in/code?next=${encodeURIComponent("/account/clubs/club-1")}`,
      signInCode: { required: true, sent: true },
    });
  });

  it("the unified sign-in leaves a staff sign-in alone: its second step is already stronger", async () => {
    mocks.unifiedPasswordSignIn.mockResolvedValue({
      kind: "signed_in",
      staff: { userId: "user-1", globalRole: "EVENT_ADMIN", session: authenticated.session },
      attendee: authenticated,
    });
    await UNIFIED_SIGN_IN(post("/api/sign-in", signInBody));
    expect(mocks.startSignInCodeIfRequired).not.toHaveBeenCalled();
  });
});

describe("two-step setup while the code is still owed", () => {
  it("refuses the authenticator actions, so a password alone cannot enrol a device", async () => {
    for (const body of [{ action: "begin" }, { action: "confirm", code: "123456" }, { action: "disable", code: "123456" }]) {
      const response = await MFA(post("/api/attendee/mfa", body));
      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("SIGN_IN_CODE_REQUIRED");
    }
    expect(mocks.beginEnrollment).not.toHaveBeenCalled();
  });

  it("refuses adding a passkey before parsing or registering anything", async () => {
    const request = post("/api/attendee/passkeys/registration", { response: {}, name: "x" });
    const parse = vi.spyOn(request, "json");
    const response = await PASSKEY_REGISTRATION(request);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("SIGN_IN_CODE_REQUIRED");
    expect(parse).not.toHaveBeenCalled();
    expect(mocks.finishPasskeyRegistration).not.toHaveBeenCalled();
  });

  it("opens again once the code has been entered", async () => {
    mocks.accountNeedsSignInStep.mockResolvedValue("OK");
    mocks.beginEnrollment.mockResolvedValue({ secret: "synthetic", otpauthUri: "otpauth://totp/x" });
    const response = await MFA(post("/api/attendee/mfa", { action: "begin" }));
    expect(response.status).toBe(200);
  });
});
