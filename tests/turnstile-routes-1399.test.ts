import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1399: a rejected Security check returns its error and causes no write or email; with the keys unset the routes pass
 * straight through. Siteverify is mocked: no network. Synthetic data only.
 */

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  authenticateWithPassword: vi.fn(),
  issuePasswordReset: vi.fn(),
  sendAccountRecoveryEmail: vi.fn(),
  submitPublicRegistration: vi.fn(),
  checkLoginClientRateLimit: vi.fn(),
  checkLoginAccountRateLimit: vi.fn(),
  checkPasswordResetClientRateLimit: vi.fn(),
  checkPasswordResetAccountRateLimit: vi.fn(),
  checkPublicRegistrationRateLimit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/turnstile/siteverify", () => ({ verifyTurnstileToken: mocks.verify }));
vi.mock("@/modules/access/auth-service", () => ({
  authenticateWithPassword: mocks.authenticateWithPassword,
  issuePasswordReset: mocks.issuePasswordReset,
}));
vi.mock("@/modules/communications/account-email-dispatch", () => ({ sendAccountRecoveryEmail: mocks.sendAccountRecoveryEmail }));
vi.mock("@/modules/access/session-store", () => ({ SESSION_COOKIE_NAME: "imsda_session", SESSION_LIFETIME_SECONDS: 3600 }));
vi.mock("@/modules/access/post-login-destination", () => ({ resolvePostLoginDestination: vi.fn(async () => "/overview") }));
vi.mock("@/modules/access/mfa-service", () => ({ issueMfaChallenge: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }) }));
vi.mock("@/modules/rate-limit/service", () => ({
  checkLoginClientRateLimit: mocks.checkLoginClientRateLimit,
  checkLoginAccountRateLimit: mocks.checkLoginAccountRateLimit,
  checkPasswordResetClientRateLimit: mocks.checkPasswordResetClientRateLimit,
  checkPasswordResetAccountRateLimit: mocks.checkPasswordResetAccountRateLimit,
  checkPublicRegistrationRateLimit: mocks.checkPublicRegistrationRateLimit,
  checkPublicFormRoommateLookupRateLimit: vi.fn(),
  publicRequestClientHash: () => "client-hash",
}));
vi.mock("@/modules/forms/public-repository", () => ({
  getPublicRegistrationExperience: vi.fn(),
  PublicRegistrationError: class extends Error {},
  submitPublicRegistration: mocks.submitPublicRegistration,
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/public-metrics/repository", () => ({ recordPublicMetric: vi.fn() }));

import { POST as login } from "@/app/api/auth/login/route";
import { POST as passwordResetRequest } from "@/app/api/auth/password-reset/request/route";
import { POST as register } from "@/app/api/public/events/[eventSlug]/forms/[formSlug]/registrations/route";

const ORIGIN = "https://events.imsda.test";

function allowed(policy: string) {
  return { allowed: true, decisions: [{ policy, allowed: true, limit: 10, remaining: 9, count: 1, windowSeconds: 900, resetAfterSeconds: 900 }] };
}

function post(path: string, body: unknown, token?: string) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...(token ? { "x-turnstile-token": token } : {}) },
    body: JSON.stringify(body),
  });
}

const loginRequest = (token?: string) => post("/api/auth/login", { email: "person@example.test", password: "not-the-password" }, token);
const resetRequest = (token?: string) => post("/api/auth/password-reset/request", { email: "person@example.test" }, token);
const registrationRequest = (token?: string) => post(
  "/api/public/events/summer-retreat/forms/attendee/registrations",
  { versionId: "version-1", idempotencyKey: "f4f76d46-f7d6-443d-a030-cb9a8ca15066", responses: {}, website: "" },
  token,
);
const registrationContext = { params: Promise.resolve({ eventSlug: "summer-retreat", formSlug: "attendee" }) };

beforeEach(() => {
  mocks.checkLoginClientRateLimit.mockResolvedValue(allowed("auth.login.client"));
  mocks.checkLoginAccountRateLimit.mockResolvedValue(allowed("auth.login.account"));
  mocks.checkPasswordResetClientRateLimit.mockResolvedValue(allowed("auth.password-reset.client"));
  mocks.checkPasswordResetAccountRateLimit.mockResolvedValue(allowed("auth.password-reset.account"));
  mocks.checkPublicRegistrationRateLimit.mockResolvedValue(allowed("public.registration"));
  mocks.authenticateWithPassword.mockResolvedValue(null);
  mocks.issuePasswordReset.mockResolvedValue(null);
  mocks.sendAccountRecoveryEmail.mockResolvedValue({ configured: true, queued: true });
  mocks.submitPublicRegistration.mockResolvedValue({ confirmationCode: "SAMPLE-1" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

function enforceWith(answer: unknown) {
  vi.stubEnv("TURNSTILE_SITE_KEY", "synthetic-site-key");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "synthetic-secret-key");
  vi.stubEnv("APP_BASE_URL", ORIGIN);
  mocks.verify.mockResolvedValue(answer);
}

const rejected = { ok: false, reason: "rejected", errorCodes: ["invalid-input-response"] };

describe("with the keys unset", () => {
  it("lets sign-in, forgot password and registration through without a token and never calls Siteverify", async () => {
    vi.stubEnv("TURNSTILE_SITE_KEY", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect((await login(loginRequest())).status).toBe(401);
    expect(mocks.authenticateWithPassword).toHaveBeenCalledTimes(1);
    expect((await passwordResetRequest(resetRequest())).status).toBe(200);
    expect(mocks.sendAccountRecoveryEmail).toHaveBeenCalledTimes(1);
    expect((await register(registrationRequest(), registrationContext)).status).toBe(201);
    expect(mocks.submitPublicRegistration).toHaveBeenCalledTimes(1);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});

describe("with the keys set", () => {
  it("refuses a staff sign-in with a rejected token before checking the password", async () => {
    enforceWith(rejected);
    const response = await login(loginRequest("bad-token"));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "security_check_failed" });
    expect(mocks.authenticateWithPassword).not.toHaveBeenCalled();
  });

  it("refuses a staff sign-in with no token, and does not call Siteverify", async () => {
    enforceWith(rejected);
    const response = await login(loginRequest());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "security_check_missing" });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.authenticateWithPassword).not.toHaveBeenCalled();
  });

  it("still applies the rate limit first", async () => {
    enforceWith({ ok: true, action: "staff-sign-in", hostname: "events.imsda.test" });
    mocks.checkLoginClientRateLimit.mockResolvedValue({ ...allowed("auth.login.client"), allowed: false });
    const response = await login(loginRequest("good-token"));
    expect(response.status).toBe(429);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("lets a staff sign-in through with a good token for the staff action", async () => {
    enforceWith({ ok: true, action: "staff-sign-in", hostname: "events.imsda.test" });
    const response = await login(loginRequest("good-token"));
    expect(response.status).toBe(401); // the password was wrong; the check itself passed
    expect(mocks.authenticateWithPassword).toHaveBeenCalledTimes(1);
    expect(mocks.verify).toHaveBeenCalledWith(expect.objectContaining({ secret: "synthetic-secret-key", token: "good-token" }));
  });

  it("refuses a token minted for another form (wrong action)", async () => {
    enforceWith({ ok: true, action: "registration", hostname: "events.imsda.test" });
    expect((await login(loginRequest("good-token"))).status).toBe(403);
    expect(mocks.authenticateWithPassword).not.toHaveBeenCalled();
  });

  it("sends no reset email and issues no link on a rejected token", async () => {
    enforceWith(rejected);
    const response = await passwordResetRequest(resetRequest("bad-token"));
    expect(response.status).toBe(403);
    expect(mocks.sendAccountRecoveryEmail).not.toHaveBeenCalled();
    expect(mocks.issuePasswordReset).not.toHaveBeenCalled();
  });

  it("saves no registration on a rejected token, a wrong hostname or a Siteverify outage", async () => {
    for (const answer of [
      rejected,
      { ok: true, action: "registration", hostname: "evil.example" },
      { ok: false, reason: "unreachable", errorCodes: [] },
    ]) {
      enforceWith(answer);
      const response = await register(registrationRequest("some-token"), registrationContext);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "security_check_failed", message: expect.stringContaining("security check didn't go through") });
    }
    expect(mocks.submitPublicRegistration).not.toHaveBeenCalled();
  });

  it("saves the registration on a good token for the registration action", async () => {
    enforceWith({ ok: true, action: "registration", hostname: "events.imsda.test" });
    const response = await register(registrationRequest("good-token"), registrationContext);
    expect(response.status).toBe(201);
    expect(mocks.submitPublicRegistration).toHaveBeenCalledTimes(1);
  });
});
