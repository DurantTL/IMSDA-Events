import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #554 slice (c): no account enumeration. Password reset, attendee sign-up for an
 * existing email, the post-registration "create an account" offer and the Google
 * callback each answer identically for an existing address, an unknown address
 * and a staff address. The attendee-side services run for real against a stubbed
 * database; the staff table is never consulted by them. Synthetic data only.
 */

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  cookieSet: vi.fn(),
  cookieGet: vi.fn(),
  cookieDelete: vi.fn(),
  after: vi.fn(),
  getServerEnv: vi.fn(),
  hashPassword: vi.fn(),
  validateChosenPassword: vi.fn(),
  spendPasswordCheck: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  rateOk: vi.fn(),
  queueVerification: vi.fn(),
  queueReset: vi.fn(),
  deliver: vi.fn(),
  mintCode: vi.fn(),
  sendAccountRecoveryEmail: vi.fn(),
  issuePasswordReset: vi.fn(),
  exchangeCode: vi.fn(),
  verifyIdToken: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/attendee-accounts/sign-in-code-issue", () => ({ startSignInCodeIfRequired: async () => ({ required: false }) }));
vi.mock("next/server", async (importOriginal) => ({ ...await importOriginal<typeof import("next/server")>(), after: mocks.after }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet, set: mocks.cookieSet, delete: mocks.cookieDelete }),
}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/modules/access/passwords", () => ({
  hashPassword: mocks.hashPassword,
  validateChosenPassword: mocks.validateChosenPassword,
  spendPasswordCheck: mocks.spendPasswordCheck,
  verifyPassword: vi.fn(),
}));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/rate-limit/service", () => ({
  checkAttendeeSignUpRateLimit: mocks.rateOk,
  checkAttendeePasswordResetRateLimit: mocks.rateOk,
  checkAttendeeOAuthCallbackRateLimit: mocks.rateOk,
  checkPasswordResetClientRateLimit: mocks.rateOk,
  checkPasswordResetAccountRateLimit: mocks.rateOk,
}));
vi.mock("@/modules/attendee-accounts/attendee-email-dispatch", () => ({
  queueAttendeeVerificationEmail: mocks.queueVerification,
  queueAttendeePasswordResetEmail: mocks.queueReset,
  deliverQueuedAttendeeEmail: mocks.deliver,
}));
vi.mock("@/modules/attendee-accounts/attendee-email", () => ({ mintAttendeeCodeWithoutSending: mocks.mintCode }));
vi.mock("@/modules/communications/account-email-dispatch", () => ({ sendAccountRecoveryEmail: mocks.sendAccountRecoveryEmail }));
vi.mock("@/modules/access/auth-service", () => ({ issuePasswordReset: mocks.issuePasswordReset }));
vi.mock("@/integrations/oauth/google", () => ({
  isGoogleSignInConfigured: () => true,
  exchangeGoogleAuthorizationCode: mocks.exchangeCode,
  verifyGoogleIdToken: mocks.verifyIdToken,
}));

import { POST as ATTENDEE_SIGN_UP } from "@/app/api/attendee/sign-up/route";
import { POST as ATTENDEE_RESET } from "@/app/api/attendee/password-reset/request/route";
import { POST as STAFF_RESET } from "@/app/api/auth/password-reset/request/route";
import { GET as GOOGLE_CALLBACK } from "@/app/api/attendee/oauth/google/callback/route";
import { RegistrationAccountPrompt } from "@/components/registration-account-prompt";
import { accountPromptVisible } from "@/modules/forms/account-prompt";

type Case = "existing" | "unknown" | "staff";
const CASES: Case[] = ["existing", "unknown", "staff"];
const EMAIL: Record<Case, string> = {
  existing: "existing.person@example.test",
  unknown: "nobody.here@example.test",
  staff: "staff.person@example.test",
};

const allowed = { allowed: true, decisions: [] };

/**
 * One stubbed database for the three kinds of address. Only an "existing" address has an
 * attendee account. A "staff" address has a staff `User` row that the attendee flows must never read.
 */
function database(kind: Case) {
  const userFindUnique = vi.fn(async () => (kind === "staff" ? { id: "staff-1" } : null));
  const account = kind === "existing"
    ? {
      id: "acct-existing",
      status: "ACTIVE",
      displayName: "Existing Person",
      disabledAt: null,
      credential: { id: "cred-1", disabledAt: null },
      identities: [],
    }
    : null;
  const tx = {
    attendeeIdentity: { create: vi.fn(async () => ({})) },
    attendeeAccount: { updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  mocks.getPrisma.mockReturnValue({
    user: { findUnique: userFindUnique, findFirst: userFindUnique },
    attendeeIdentity: { findUnique: vi.fn(async () => null), create: tx.attendeeIdentity.create },
    attendeeAccount: {
      findUnique: vi.fn(async () => account),
      create: vi.fn(async () => ({ id: "acct-new" })),
      update: vi.fn(async () => ({ id: "acct-existing" })),
    },
    attendeeAccountToken: { updateMany: vi.fn(async () => ({ count: 0 })), create: vi.fn(async () => ({})) },
    attendeeSession: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (arg: unknown) => (typeof arg === "function" ? (arg as (t: typeof tx) => unknown)(tx) : arg)),
  });
  return { userFindUnique };
}

async function observable(response: Response) {
  const headers = Object.fromEntries([...response.headers.entries()].filter(([name]) => name !== "x-correlation-id"));
  const text = await response.text();
  return { status: response.status, headers, body: text };
}

/** Cookie names and options with the random token value masked out. */
function cookieShape() {
  return mocks.cookieSet.mock.calls.map(([name, value, options]) => ({
    name,
    hasValue: typeof value === "string" && value.length > 0,
    httpOnly: options?.httpOnly,
    path: options?.path,
    sameSite: options?.sameSite,
  }));
}

function post(path: string, body: Record<string, unknown>) {
  return new Request(`https://events.imsda.test${path}`, {
    method: "POST",
    headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getServerEnv.mockReturnValue({ APP_BASE_URL: "https://events.imsda.test" });
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.rateOk.mockResolvedValue(allowed);
  mocks.hashPassword.mockResolvedValue("hashed");
  mocks.validateChosenPassword.mockResolvedValue(null);
  mocks.spendPasswordCheck.mockResolvedValue(undefined);
  mocks.queueVerification.mockResolvedValue({ configured: true, messageId: null });
  mocks.queueReset.mockResolvedValue({ configured: true, messageId: null });
  mocks.mintCode.mockResolvedValue("123456");
  mocks.sendAccountRecoveryEmail.mockResolvedValue({ configured: true });
  mocks.issuePasswordReset.mockResolvedValue(null);
  mocks.cookieGet.mockReturnValue(undefined);
});

async function collect(run: (kind: Case) => Promise<Response>) {
  const seen: Array<{ kind: Case; response: Awaited<ReturnType<typeof observable>>; cookies: ReturnType<typeof cookieShape>; staffTableRead: number }> = [];
  for (const kind of CASES) {
    mocks.cookieSet.mockClear();
    const { userFindUnique } = database(kind);
    const response = await observable(await run(kind));
    seen.push({ kind, response, cookies: cookieShape(), staffTableRead: userFindUnique.mock.calls.length });
  }
  return seen;
}

describe("attendee sign-up for an existing email", () => {
  it("answers the same for an existing, an unknown and a staff address, and never reads the staff table", async () => {
    const seen = await collect((kind) => ATTENDEE_SIGN_UP(post("/api/attendee/sign-up", {
      email: EMAIL[kind], displayName: "Synthetic Person", password: "synthetic-Passphrase-4-test",
    })));
    expect(seen[0].response.status).toBe(200);
    for (const result of seen) {
      expect(result.response).toEqual(seen[0].response);
      expect(result.cookies).toEqual(seen[0].cookies);
      expect(result.staffTableRead).toBe(0);
    }
    expect(JSON.parse(seen[0].response.body)).toEqual({ ok: true, message: "Check your email for a six-digit code, then enter it below." });
  });
});

describe("attendee password reset", () => {
  it("answers the same for an existing, an unknown and a staff address, and never reads the staff table", async () => {
    const seen = await collect((kind) => ATTENDEE_RESET(post("/api/attendee/password-reset/request", { email: EMAIL[kind] })));
    expect(seen[0].response.status).toBe(200);
    for (const result of seen) {
      expect(result.response).toEqual(seen[0].response);
      expect(result.cookies).toEqual(seen[0].cookies);
      expect(result.staffTableRead).toBe(0);
    }
  });
});

describe("staff password reset request", () => {
  it("answers the same for an existing, an unknown and a staff address", async () => {
    // The services decide whether anything is sent; what the caller sees must not depend on it.
    const seen: Array<Awaited<ReturnType<typeof observable>>> = [];
    for (const kind of CASES) {
      mocks.sendAccountRecoveryEmail.mockResolvedValue({ configured: true, queued: kind !== "unknown" });
      seen.push(await observable(await STAFF_RESET(post("/api/auth/password-reset/request", { email: EMAIL[kind] }))));
    }
    expect(seen[0].status).toBe(200);
    for (const result of seen) expect(result).toEqual(seen[0]);
    expect(JSON.parse(seen[0].body).message).toBe("If that account exists, password reset instructions are ready.");
    expect(JSON.parse(seen[0].body)).not.toHaveProperty("resetUrl");
  });

  it("never returns a reset link in production, even with account email unconfigured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      mocks.sendAccountRecoveryEmail.mockResolvedValue({ configured: false });
      mocks.issuePasswordReset.mockResolvedValue("a-real-token");
      const body = JSON.parse((await observable(await STAFF_RESET(post("/api/auth/password-reset/request", { email: EMAIL.existing })))).body);
      expect(body).not.toHaveProperty("resetUrl");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("the Google callback", () => {
  it("lands an existing, an unknown and a staff address on the same page with the same cookies", async () => {
    mocks.cookieGet.mockReturnValue({ value: JSON.stringify({ state: "s", nonce: "n", codeVerifier: "v" }) });
    mocks.exchangeCode.mockResolvedValue("id-token");
    const seen: Array<{ location: string | null; status: number; cookies: ReturnType<typeof cookieShape>; staffTableRead: number }> = [];
    for (const kind of CASES) {
      mocks.cookieSet.mockClear();
      const { userFindUnique } = database(kind);
      mocks.verifyIdToken.mockResolvedValue({ subject: `sub-${kind}`, email: EMAIL[kind], emailVerified: true, name: "Synthetic Person" });
      const response = await GOOGLE_CALLBACK(new Request("https://events.imsda.test/api/attendee/oauth/google/callback?code=c&state=s"));
      // Cookie shape without the clearing calls the route makes for its own handoff cookies.
      const sessionCookies = cookieShape().filter((cookie) => cookie.hasValue);
      seen.push({ location: response.headers.get("location"), status: response.status, cookies: sessionCookies, staffTableRead: userFindUnique.mock.calls.length });
    }
    expect(seen[0].location).toBe("https://events.imsda.test/account");
    for (const result of seen) {
      expect(result).toEqual(seen[0]);
      expect(result.cookies.map((cookie) => cookie.name)).toContain("imsda_attendee_session");
      expect(result.cookies.map((cookie) => cookie.name)).not.toContain("imsda_session");
      expect(result.staffTableRead).toBe(0);
    }
  });
});

describe("the post-registration offer to create an account", () => {
  const markup = (email: string) => renderToStaticMarkup(createElement(RegistrationAccountPrompt, { email, embedded: false }));

  it("renders the same offer for any address, apart from the address the visitor typed", () => {
    const existing = markup(EMAIL.existing).replaceAll(encodeURIComponent(EMAIL.existing), "ADDRESS");
    const unknown = markup(EMAIL.unknown).replaceAll(encodeURIComponent(EMAIL.unknown), "ADDRESS");
    const staff = markup(EMAIL.staff).replaceAll(encodeURIComponent(EMAIL.staff), "ADDRESS");
    expect(unknown).toBe(existing);
    expect(staff).toBe(existing);
    expect(existing).toContain("Create account");
    expect(existing).toContain("Sign in to an existing account");
    expect(existing).toContain("No account is required");
  });

  it("is shown to a signed-out registrant, and not to a signed-in one or a club registration", () => {
    expect(accountPromptVisible({ signedIn: false, clubRegistration: false })).toBe(true);
    expect(accountPromptVisible({ signedIn: true, clubRegistration: false })).toBe(false);
    expect(accountPromptVisible({ signedIn: false, clubRegistration: true })).toBe(false);
  });
});
