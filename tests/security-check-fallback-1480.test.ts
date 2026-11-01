import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1480: when a privacy browser blocks the Security check, sign-in/sign-up/reset take an emailed code and the other
 * public forms take a strictly limited tokenless submission. An INVALID token is never bypassed. Siteverify, the
 * database, the outbox and the rate limiter are fakes: no network. Synthetic addresses and codes only.
 */

const state = vi.hoisted(() => ({
  codes: [] as Array<Record<string, unknown>>,
  outbox: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  staff: [] as string[],
  attendees: [] as string[],
  afterTasks: [] as Array<() => unknown>,
  sequence: 0,
  configured: true,
  sealFails: false,
  outboxFails: false,
}));

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  authenticateWithPassword: vi.fn(),
  submitPublicRegistration: vi.fn(),
  sendSendLimit: vi.fn(),
  fallbackLimit: vi.fn(),
}));

function matches(row: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key];
    if (condition === null) return value === null || value === undefined;
    if (condition && typeof condition === "object") {
      const spec = condition as { gt?: Date | number; lt?: Date | number; not?: unknown };
      if ("gt" in spec) return value instanceof Date ? value.getTime() > (spec.gt as Date).getTime() : false;
      if ("lt" in spec) return typeof value === "number" ? value < (spec.lt as number) : false;
      if ("not" in spec) return spec.not === null ? value !== null && value !== undefined : value !== spec.not;
    }
    return value === condition;
  });
}

function apply(row: Record<string, unknown>, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && "increment" in (value as object)) {
      row[key] = (row[key] as number) + (value as { increment: number }).increment;
    } else row[key] = value;
  }
}

const fakePrisma = {
  $executeRaw: async () => 0,
  $transaction: async (run: (tx: unknown) => unknown) => run(fakePrisma),
  securityCheckCode: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `code-${++state.sequence}`, attempts: 0, consumedAt: null, codeHash: null, deliveryMessageId: null, sealedCode: null, codeExpiresAt: null, createdAt: new Date(), ...data };
      state.codes.push(row);
      return row;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const found = state.codes.filter((row) => matches(row, where));
      found.forEach((row) => apply(row, data));
      return { count: found.length };
    },
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      const found = state.codes.filter((row) => matches(row, where));
      found.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
      return found[0] ?? null;
    },
    findUnique: async ({ where }: { where: { id: string } }) => state.codes.find((row) => row.id === where.id) ?? null,
  },
  user: {
    findFirst: async ({ where }: { where: { email: { equals: string } } }) =>
      state.staff.includes(where.email.equals) ? { id: "user-1" } : null,
  },
  attendeeAccount: {
    findFirst: async ({ where }: { where: { email: { equals: string } } }) =>
      state.attendees.includes(where.email.equals) ? { id: "account-1" } : null,
  },
  messageOutbox: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      if (state.outboxFails) throw new Error("outbox unavailable");
      const row = { id: `message-${++state.sequence}`, ...data };
      state.outbox.push(row);
      return { id: row.id };
    },
  },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => fakePrisma }));
vi.mock("@/lib/secret-box", () => ({
  sealSecret: (value: string) => {
    if (state.sealFails) throw new Error("SECRET_ENCRYPTION_KEY must be set");
    return `sealed:${value}`;
  },
  openSecret: (value: string) => value.slice("sealed:".length),
}));
vi.mock("@/modules/audit/audit-service", () => ({
  writeAuditLog: vi.fn(async (entry: Record<string, unknown>) => { state.audits.push(entry); }),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => { state.afterTasks.push(task); },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }) }));
vi.mock("@/integrations/turnstile/siteverify", () => ({ verifyTurnstileToken: mocks.verify }));
vi.mock("@/modules/communications/account-email", () => ({
  isAccountEmailConfigured: () => state.configured,
  getAccountEmailSender: () => ({ name: "IMSDA Events", address: "events@imsda.test", replyTo: null }),
}));
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: vi.fn(async () => ({ sentIds: [], rescheduledIds: [] })) }));
vi.mock("@/modules/attendee-accounts/attendee-email", () => ({
  spacedSignInCode: (code: string) => (code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code),
}));
vi.mock("@/modules/account-merge/account-link", () => ({ isUnifiedSignInEnabled: async () => false }));
vi.mock("@/modules/access/auth-service", () => ({ authenticateWithPassword: mocks.authenticateWithPassword }));
vi.mock("@/modules/access/session-store", () => ({ SESSION_COOKIE_NAME: "imsda_session", SESSION_LIFETIME_SECONDS: 3600 }));
vi.mock("@/modules/access/post-login-destination", () => ({ resolvePostLoginDestination: vi.fn(async () => "/overview") }));
vi.mock("@/modules/access/mfa-service", () => ({ issueMfaChallenge: vi.fn() }));
vi.mock("@/modules/public-metrics/repository", () => ({ recordPublicMetric: vi.fn() }));
vi.mock("@/modules/forms/public-repository", () => ({
  getPublicRegistrationExperience: vi.fn(),
  PublicRegistrationError: class extends Error {},
  submitPublicRegistration: mocks.submitPublicRegistration,
}));
vi.mock("@/modules/rate-limit/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/rate-limit/service")>()),
  checkLoginClientRateLimit: async () => ({ allowed: true, decisions: [] }),
  checkLoginAccountRateLimit: async () => ({ allowed: true, decisions: [] }),
  checkPublicRegistrationRateLimit: async () => ({ allowed: true, decisions: [] }),
  checkPublicFormRoommateLookupRateLimit: async () => ({ allowed: true, decisions: [] }),
  publicRequestClientHash: () => "client-hash",
  checkSecurityCheckCodeSendRateLimit: mocks.sendSendLimit,
  checkSecurityCheckFallbackRateLimit: mocks.fallbackLimit,
}));

import { POST as requestCode } from "@/app/api/security-check/email-code/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as register } from "@/app/api/public/events/[eventSlug]/forms/[formSlug]/registrations/route";
import { prepareSecurityCheckCodeForDelivery } from "@/modules/security/security-check-code-email";
import { SECURITY_CHECK_FALLBACK_BUDGETS } from "@/modules/rate-limit/service";
import { ONE_TIME_CODE_MAX_ATTEMPTS } from "@/modules/attendee-accounts/codes";

const ORIGIN = "https://events.imsda.test";
const ALLOWED = { allowed: true, decisions: [] };
const KNOWN = "staff.person@example.test";
const UNKNOWN = "nobody.here@example.test";

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}
const codeRequest = (email: string, action = "staff-sign-in") => post("/api/security-check/email-code", { action, email });
const loginWith = (headers: Record<string, string> = {}, email = KNOWN) =>
  post("/api/auth/login", { email, password: "not-the-password" }, headers);
const registrationBody = { versionId: "version-1", idempotencyKey: "f4f76d46-f7d6-443d-a030-cb9a8ca15066", responses: { contactEmail: "family@example.test" }, website: "" };
const registrationContext = { params: Promise.resolve({ eventSlug: "summer-retreat", formSlug: "attendee" }) };
const registrationWith = (headers: Record<string, string> = {}, body: unknown = registrationBody) =>
  post("/api/public/events/summer-retreat/forms/attendee/registrations", body, headers);

/** The work the route schedules for after its response (eligibility, outbox, audit, delivery). */
async function runAfterResponse() {
  const tasks = state.afterTasks.splice(0);
  for (const task of tasks) await task();
}

/** What the delivery worker does with the queued message: mint the code into it. Returns the digits. */
async function deliverLatestCode() {
  await runAfterResponse();
  const message = state.outbox.at(-1)!;
  const prepared = await prepareSecurityCheckCodeForDelivery({
    messageId: message.id as string,
    bodyText: message.bodyTextSnapshot as string,
    now: new Date(),
  });
  return prepared.codeBox.code.replace(/\s+/g, "");
}

function enforce(answer: unknown = { ok: false, reason: "rejected", errorCodes: ["invalid-input-response"] }) {
  vi.stubEnv("TURNSTILE_SITE_KEY", "synthetic-site-key");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "synthetic-secret-key");
  vi.stubEnv("APP_BASE_URL", ORIGIN);
  mocks.verify.mockResolvedValue(answer);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
  state.codes.length = 0;
  state.outbox.length = 0;
  state.audits.length = 0;
  state.afterTasks.length = 0;
  state.staff.splice(0, state.staff.length, KNOWN);
  state.attendees.length = 0;
  state.sequence = 0;
  state.configured = true;
  state.sealFails = false;
  state.outboxFails = false;
  mocks.sendSendLimit.mockResolvedValue(ALLOWED);
  mocks.fallbackLimit.mockResolvedValue(ALLOWED);
  mocks.authenticateWithPassword.mockResolvedValue(null);
  mocks.submitPublicRegistration.mockResolvedValue({ confirmationCode: "SAMPLE-1" });
  enforce();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("email code: blocked check on staff sign-in", () => {
  it("requests a code, then signs in with the code and no token, once", async () => {
    expect((await requestCode(codeRequest(KNOWN))).status).toBe(202);
    const code = await deliverLatestCode();
    expect(state.outbox).toHaveLength(1);

    const first = await login(loginWith({ "x-security-check-code": code }));
    expect(first.status).toBe(401); // the password was wrong; the security check itself passed
    expect(mocks.authenticateWithPassword).toHaveBeenCalledTimes(1);
    expect(mocks.verify).not.toHaveBeenCalled();

    const second = await login(loginWith({ "x-security-check-code": code }));
    expect(second.status).toBe(403);
    expect(await second.json()).toMatchObject({ code: "security_check_failed" });
    expect(mocks.authenticateWithPassword).toHaveBeenCalledTimes(1);
  });

  it("accepts the code as shown in the email, with its space", async () => {
    await requestCode(codeRequest(KNOWN));
    const code = await deliverLatestCode();
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect((await login(loginWith({ "x-security-check-code": spaced }))).status).toBe(401);
    expect(mocks.authenticateWithPassword).toHaveBeenCalledTimes(1);
  });

  it("rejects a wrong code, a code for another address and an expired code", async () => {
    await requestCode(codeRequest(KNOWN));
    const code = await deliverLatestCode();
    const wrong = code === "000000" ? "111111" : "000000";
    expect((await login(loginWith({ "x-security-check-code": wrong }))).status).toBe(403);
    // Another address's request cannot use it.
    expect((await login(loginWith({ "x-security-check-code": code }, "someone.else@example.test"))).status).toBe(403);
    expect(mocks.authenticateWithPassword).not.toHaveBeenCalled();
    // Ten minutes later it is dead even for its own address.
    vi.setSystemTime(new Date("2026-11-01T12:10:01Z"));
    expect((await login(loginWith({ "x-security-check-code": code }))).status).toBe(403);
    expect(mocks.authenticateWithPassword).not.toHaveBeenCalled();
  });

  it("is a different code per action: a staff sign-in code does not open the attendee sign-up", async () => {
    await requestCode(codeRequest(KNOWN, "staff-sign-in"));
    const code = await deliverLatestCode();
    const row = state.codes.find((entry) => entry.action === "staff-sign-in")!;
    expect(row.action).toBe("staff-sign-in");
    // Verified directly against the store: same address, other action.
    const { verifySecurityCheckCode } = await import("@/modules/security/security-check-code-store");
    expect(await verifySecurityCheckCode({ action: "attendee-sign-up", email: KNOWN, code })).toMatchObject({ ok: false });
    expect(await verifySecurityCheckCode({ action: "staff-sign-in", email: KNOWN, code })).toMatchObject({ ok: true });
  });

  it("stops after the attempt ceiling, even for the right code", async () => {
    await requestCode(codeRequest(KNOWN));
    const code = await deliverLatestCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < ONE_TIME_CODE_MAX_ATTEMPTS; attempt += 1) {
      expect((await login(loginWith({ "x-security-check-code": wrong }))).status).toBe(403);
    }
    expect((await login(loginWith({ "x-security-check-code": code }))).status).toBe(403);
    expect(mocks.authenticateWithPassword).not.toHaveBeenCalled();
  });

  it("a new code retires the earlier one", async () => {
    await requestCode(codeRequest(KNOWN));
    const first = await deliverLatestCode();
    await requestCode(codeRequest(KNOWN));
    const second = await deliverLatestCode();
    expect((await login(loginWith({ "x-security-check-code": first }))).status).toBe(403);
    expect((await login(loginWith({ "x-security-check-code": second }))).status).toBe(401);
  });

  it("never bypasses an INVALID token: a valid code beside it is ignored and stays unspent", async () => {
    await requestCode(codeRequest(KNOWN));
    const code = await deliverLatestCode();
    const response = await login(loginWith({ "x-turnstile-token": "bad-token", "x-security-check-code": code }));
    expect(response.status).toBe(403);
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(mocks.authenticateWithPassword).not.toHaveBeenCalled();
    // Still unspent: the same code works once there is no token.
    expect((await login(loginWith({ "x-security-check-code": code }))).status).toBe(401);
  });

  it("with neither a token nor a code is still security_check_missing", async () => {
    const response = await login(loginWith());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "security_check_missing" });
  });

  it("changes nothing while the check is off", async () => {
    vi.stubEnv("TURNSTILE_SITE_KEY", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect((await login(loginWith())).status).toBe(401);
    expect(mocks.authenticateWithPassword).toHaveBeenCalledTimes(1);
  });

  it("audits ids only, never the address, the code or a hash", async () => {
    await requestCode(codeRequest(KNOWN));
    const code = await deliverLatestCode();
    await login(loginWith({ "x-security-check-code": code }));
    await login(loginWith({ "x-security-check-code": code }));
    const actions = state.audits.map((entry) => entry.action);
    expect(actions).toEqual(["SECURITY_CHECK_CODE_SENT", "SECURITY_CHECK_CODE_VERIFIED", "SECURITY_CHECK_CODE_FAILED"]);
    const text = JSON.stringify(state.audits);
    expect(text).not.toContain(KNOWN);
    expect(text).not.toContain(code);
    expect(text).not.toMatch(/[0-9a-f]{64}/);
  });
});

describe("email code request: no account enumeration", () => {
  it("answers identically for a known and an unknown address, and queues mail only for the known one", async () => {
    const known = await requestCode(codeRequest(KNOWN));
    const knownBody = await known.json();
    // Before the response ends nothing differs: no lookup result, no outbox row, for either address.
    expect(state.outbox).toHaveLength(0);
    const unknown = await requestCode(codeRequest(UNKNOWN));
    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(knownBody);
    expect(known.status).toBe(202);
    expect(knownBody).toMatchObject({ ok: true, message: "If that address can use this, we sent a code. It works for 10 minutes." });
    expect(state.outbox).toHaveLength(0);
    expect(state.afterTasks).toHaveLength(2);
    await runAfterResponse();
    expect(state.outbox).toHaveLength(1);
  });

  it("still answers 202 when the outbox write fails for a known address", async () => {
    state.outboxFails = true;
    const known = await requestCode(codeRequest(KNOWN));
    const unknown = await requestCode(codeRequest(UNKNOWN));
    expect(known.status).toBe(202);
    expect(await known.json()).toEqual(await unknown.json());
    await expect(runAfterResponse()).resolves.toBeUndefined();
    expect(state.outbox).toHaveLength(0);
  });

  it("development (no account email): a known address gets the code in the response, an unknown one the same 202 without it, and a missing secret key never makes a 500", async () => {
    state.configured = false;
    const known = await requestCode(codeRequest(KNOWN));
    const knownBody = await known.json();
    expect(known.status).toBe(202);
    expect(knownBody.developmentCode).toMatch(/^\d{6}$/);
    const unknown = await requestCode(codeRequest(UNKNOWN));
    expect(unknown.status).toBe(202);
    expect((await unknown.json()).developmentCode).toBeUndefined();
    state.sealFails = true;
    const noKey = await requestCode(codeRequest(KNOWN));
    expect(noKey.status).toBe(202);
    expect((await noKey.json()).developmentCode).toBeUndefined();
  });

  it("refuses a filled honeypot on the code request", async () => {
    const response = await requestCode(post("/api/security-check/email-code", { action: "staff-sign-in", email: KNOWN, website: "http://spam.example" }));
    expect(response.status).toBe(400);
    expect(state.codes).toHaveLength(0);
  });

  it("never mints a usable code for an unknown address", async () => {
    await requestCode(codeRequest(UNKNOWN));
    await runAfterResponse();
    expect(state.codes.every((row) => row.codeHash === null && row.deliveryMessageId === null)).toBe(true);
    expect(JSON.stringify(state.codes)).not.toContain(UNKNOWN);
  });

  it("stores the address only as a hash", async () => {
    await requestCode(codeRequest(KNOWN));
    expect(JSON.stringify(state.codes)).not.toContain(KNOWN);
    expect(state.codes[0].emailHash).toMatch(/^[0-9a-f]{64}$/);
    // Keyed, not a bare sha256 of the address.
    const { createHash } = await import("node:crypto");
    expect(state.codes[0].emailHash).not.toBe(createHash("sha256").update(KNOWN).digest("hex"));
  });

  it("sends for a sign-up to any address, and sends for sign-in only when an account exists", async () => {
    expect((await requestCode(codeRequest("new.person@example.test", "attendee-sign-up"))).status).toBe(202);
    await runAfterResponse();
    expect(state.outbox).toHaveLength(1);
    expect((await requestCode(codeRequest(UNKNOWN, "attendee-sign-in"))).status).toBe(202);
    expect((await requestCode(codeRequest(UNKNOWN, "forgot-password"))).status).toBe(202);
    await runAfterResponse();
    expect(state.outbox).toHaveLength(1);
    state.attendees.push("reg.person@example.test");
    expect((await requestCode(codeRequest("reg.person@example.test", "attendee-sign-in"))).status).toBe(202);
    expect((await requestCode(codeRequest("reg.person@example.test", "forgot-password"))).status).toBe(202);
    await runAfterResponse();
    expect(state.outbox).toHaveLength(3);
  });

  it("refuses actions that are not sign-in, sign-up or reset, and cross-origin calls", async () => {
    expect((await requestCode(codeRequest(KNOWN, "registration"))).status).toBe(400);
    const crossOrigin = new Request(`${ORIGIN}/api/security-check/email-code`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ action: "staff-sign-in", email: KNOWN }),
    });
    expect((await requestCode(crossOrigin)).status).toBe(403);
    expect(state.outbox).toHaveLength(0);
  });

  it("is rate limited the same for any address", async () => {
    mocks.sendSendLimit.mockResolvedValue({ allowed: false, decisions: [] });
    const response = await requestCode(codeRequest(KNOWN));
    expect(response.status).toBe(429);
    expect(state.outbox).toHaveLength(0);
  });
});

describe("public forms: no token", () => {
  it("is allowed under the strict limit, flagged in the audit log without personal data", async () => {
    const response = await register(registrationWith(), registrationContext);
    expect(response.status).toBe(201);
    expect(mocks.submitPublicRegistration).toHaveBeenCalledTimes(1);
    expect(mocks.fallbackLimit).toHaveBeenCalledWith(expect.any(Request), "family@example.test");
    const flagged = state.audits.find((entry) => entry.action === "SECURITY_CHECK_FALLBACK_ACCEPTED");
    expect(flagged).toMatchObject({ entityId: "registration", metadata: { checkAction: "registration", route: "/api/public/events/summer-retreat/forms/attendee/registrations" } });
    expect(JSON.stringify(flagged)).not.toContain("family@example.test");
  });

  it("is refused with a 429 over the strict limit and saves nothing", async () => {
    mocks.fallbackLimit.mockResolvedValue({ allowed: false, decisions: [] });
    const response = await register(registrationWith(), registrationContext);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "RATE_LIMITED", message: expect.stringContaining("security check") });
    expect(mocks.submitPublicRegistration).not.toHaveBeenCalled();
  });

  it("never bypasses an INVALID token", async () => {
    const response = await register(registrationWith({ "x-turnstile-token": "bad-token" }), registrationContext);
    expect(response.status).toBe(403);
    expect(mocks.fallbackLimit).not.toHaveBeenCalled();
    expect(mocks.submitPublicRegistration).not.toHaveBeenCalled();
  });

  it("still rejects a filled honeypot before any fallback is considered", async () => {
    const response = await register(registrationWith({}, { ...registrationBody, website: "http://spam.example" }), registrationContext);
    expect(response.status).toBe(400);
    expect(mocks.fallbackLimit).not.toHaveBeenCalled();
    expect(mocks.submitPublicRegistration).not.toHaveBeenCalled();
  });

  it("keeps the budget constants strict", () => {
    expect(SECURITY_CHECK_FALLBACK_BUDGETS).toEqual({ client: 3, email: 2, windowSeconds: 3600 });
  });
});
