import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The lost-device recovery routes and "Sign out everywhere else" (#221): own attendee session only, same-origin only,
 * the rate limit charged before anything is read, one answer whether or not the account has a method, and no code or
 * hash in any response. Synthetic data only.
 */

const mocks = vi.hoisted(() => ({
  getCurrentAttendee: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  sendRateLimit: vi.fn(),
  verifyRateLimit: vi.fn(),
  signOutRateLimit: vi.fn(),
  hasMethod: vi.fn(),
  needsSignInStep: vi.fn(),
  completedRecoveries: vi.fn(),
  beginRecovery: vi.fn(),
  queueCodeEmail: vi.fn(),
  complete: vi.fn(),
  notify: vi.fn(),
  hasSecondStepAccess: vi.fn(),
  signOutOthers: vi.fn(),
  listSessions: vi.fn(),
  writeAuditLog: vi.fn(),
  logError: vi.fn(),
  after: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/lib/logger", () => ({ logError: mocks.logError, logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/rate-limit/service", () => ({
  checkAttendeeTwoStepRecoverySendRateLimit: mocks.sendRateLimit,
  checkAttendeeTwoStepRecoveryVerifyRateLimit: mocks.verifyRateLimit,
  checkAttendeeSignOutOthersRateLimit: mocks.signOutRateLimit,
}));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({
  accountNeedsSignInStep: mocks.needsSignInStep,
  accountHasSecondStepAccess: mocks.hasSecondStepAccess,
}));
vi.mock("@/modules/attendee-accounts/two-step-recovery", () => ({
  TWO_STEP_RECOVERY_DAILY_LIMIT: 3,
  accountHasTwoStepMethod: mocks.hasMethod,
  countRecentCompletedTwoStepRecoveries: mocks.completedRecoveries,
  beginAttendeeTwoStepRecovery: mocks.beginRecovery,
  completeAttendeeTwoStepRecovery: mocks.complete,
}));
vi.mock("@/modules/attendee-accounts/attendee-email-dispatch", () => ({
  deliverQueuedAttendeeEmail: vi.fn(),
  queueAttendeeTwoStepRecoveryCodeEmail: mocks.queueCodeEmail,
  queueAttendeeTwoStepRecoveredEmail: vi.fn(),
}));
vi.mock("@/modules/attendee-accounts/attendee-email", () => ({ mintAttendeeCodeWithoutSending: vi.fn() }));
vi.mock("@/modules/attendee-accounts/step-up-service", () => ({ bindAttendeeStepUpMessage: vi.fn() }));
vi.mock("@/modules/attendee-accounts/account-service", () => ({ signOutOtherSessions: mocks.signOutOthers }));
vi.mock("@/modules/attendee-accounts/session-store", () => ({ listActiveAttendeeSessions: mocks.listSessions }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));

// The notice is exercised on its own below; the verify route only needs to know it was asked for.
vi.mock("@/modules/attendee-accounts/two-step-recovery-issue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/attendee-accounts/two-step-recovery-issue")>();
  return { ...actual, notifyTwoStepRecovered: mocks.notify };
});

import { POST as SEND } from "@/app/api/attendee/two-step-recovery/send/route";
import { POST as VERIFY } from "@/app/api/attendee/two-step-recovery/verify/route";
import { POST as SIGN_OUT_OTHERS } from "@/app/api/attendee/sessions/sign-out-others/route";

const ORIGIN = "https://events.imsda.test";
const account = { id: "account-1", verifiedEmail: "director@imsda-events.test", displayName: "Test Director" };
const post = (path: string, body?: unknown) => new Request(`${ORIGIN}${path}`, {
  method: "POST",
  headers: { origin: ORIGIN, "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const allowed = { allowed: true, decisions: [] };
const limited = { allowed: false, decisions: [{ policy: "attendee.two-step-recovery-send.account", allowed: false, limit: 5, remaining: 0, count: 6, windowSeconds: 3600, resetAfterSeconds: 1200 }] };
const SENT_WORDS = "If this account can be recovered, a code is on its way to director@imsda-events.test. It works for 10 minutes.";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.getCurrentAttendee.mockResolvedValue({ account, via: "attendee", sessionId: "session-1" });
  mocks.sendRateLimit.mockResolvedValue(allowed);
  mocks.verifyRateLimit.mockResolvedValue(allowed);
  mocks.signOutRateLimit.mockResolvedValue(allowed);
  mocks.hasMethod.mockResolvedValue(true);
  mocks.needsSignInStep.mockResolvedValue("VERIFY");
  mocks.completedRecoveries.mockResolvedValue(0);
  mocks.beginRecovery.mockResolvedValue({ id: "code-1", expiresAt: new Date() });
  mocks.queueCodeEmail.mockResolvedValue({ configured: true, messageId: "message-1" });
  mocks.complete.mockResolvedValue({ ok: true, codeId: "code-1", revokedSessions: 2 });
  mocks.hasSecondStepAccess.mockResolvedValue(true);
  mocks.signOutOthers.mockResolvedValue(2);
  mocks.listSessions.mockResolvedValue([{ id: "session-1", isCurrent: true, startedAt: "2026-11-09T12:00:00.000Z", lastSeenAt: "2026-11-09T12:05:00.000Z" }]);
});

describe("POST /api/attendee/two-step-recovery/send", () => {
  it("needs the person's own attendee session (a staff act-as has none)", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect((await SEND(post("/api/attendee/two-step-recovery/send"))).status).toBe(401);
    mocks.getCurrentAttendee.mockResolvedValue({ account, via: "staff", sessionId: null });
    expect((await SEND(post("/api/attendee/two-step-recovery/send"))).status).toBe(401);
    expect(mocks.sendRateLimit).not.toHaveBeenCalled();
    expect(mocks.beginRecovery).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request before anything else", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    expect((await SEND(post("/api/attendee/two-step-recovery/send"))).status).toBe(403);
    expect(mocks.getCurrentAttendee).not.toHaveBeenCalled();
  });

  it("charges the send budget first, keyed to the account, and answers 429 with the usual words", async () => {
    mocks.sendRateLimit.mockResolvedValue(limited);
    const response = await SEND(post("/api/attendee/two-step-recovery/send"));
    expect(mocks.sendRateLimit).toHaveBeenCalledWith(expect.any(Request), "account-1");
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "RATE_LIMITED", message: "Too many attempts. Wait a little while, then try again." });
    expect(response.headers.get("retry-after")).not.toBeNull();
    expect(mocks.hasMethod).not.toHaveBeenCalled();
    expect(mocks.beginRecovery).not.toHaveBeenCalled();
  });

  it("stops at the daily cap of completed recoveries, before sending", async () => {
    mocks.completedRecoveries.mockResolvedValue(3);
    const response = await SEND(post("/api/attendee/two-step-recovery/send"));
    expect(response.status).toBe(429);
    expect(mocks.beginRecovery).not.toHaveBeenCalled();
  });

  it("answers the same words and shape whether or not the account has anything to recover", async () => {
    const withMethod = await SEND(post("/api/attendee/two-step-recovery/send"));
    expect(mocks.beginRecovery).toHaveBeenCalledTimes(1);
    expect(mocks.queueCodeEmail).toHaveBeenCalledTimes(1);
    mocks.hasMethod.mockResolvedValue(false);
    const without = await SEND(post("/api/attendee/two-step-recovery/send"));
    expect(mocks.beginRecovery).toHaveBeenCalledTimes(1);
    expect(withMethod.status).toBe(200);
    expect(without.status).toBe(200);
    const [a, b] = [await withMethod.json(), await without.json()];
    expect(a).toEqual(b);
    expect(a).toEqual({ ok: true, message: SENT_WORDS });
    expect(Object.keys(a).sort()).toEqual(["message", "ok"]);
  });

  it("sends nothing to a session that still owes the emailed sign-in code, and answers the same", async () => {
    mocks.needsSignInStep.mockResolvedValue("EMAIL_CODE");
    const response = await SEND(post("/api/attendee/two-step-recovery/send"));
    expect(await response.json()).toEqual({ ok: true, message: SENT_WORDS });
    expect(mocks.beginRecovery).not.toHaveBeenCalled();
  });

  it("queues the email after the response and never returns a code or hash", async () => {
    const response = await SEND(post("/api/attendee/two-step-recovery/send"));
    expect(mocks.queueCodeEmail).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account-1", stepUpCodeId: "code-1", email: "director@imsda-events.test" }));
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await response.json())).not.toMatch(/\d{6}|hash/i);
  });
});

describe("POST /api/attendee/two-step-recovery/verify", () => {
  it("needs the person's own attendee session and refuses cross-origin requests", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account, via: "staff", sessionId: null });
    expect((await VERIFY(post("/api/attendee/two-step-recovery/verify", { code: "518207" }))).status).toBe(401);
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    expect((await VERIFY(post("/api/attendee/two-step-recovery/verify", { code: "518207" }))).status).toBe(403);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("spends the verify budget before reading or checking anything", async () => {
    mocks.verifyRateLimit.mockResolvedValue(limited);
    const request = post("/api/attendee/two-step-recovery/verify", { code: "518207" });
    const parse = vi.spyOn(request, "json");
    const response = await VERIFY(request);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "RATE_LIMITED", message: "Too many attempts. Wait a few minutes and try again." });
    expect(parse).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("checks the code for exactly this account and session, accepts '518 207', and tells the page where to go", async () => {
    const response = await VERIFY(post("/api/attendee/two-step-recovery/verify", { code: "518 207" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, setupRequired: true });
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account-1", sessionId: "session-1", code: "518 207" }));
    expect(mocks.notify).toHaveBeenCalledWith("account-1", expect.any(Date));
    mocks.hasSecondStepAccess.mockResolvedValue(false);
    expect(await (await VERIFY(post("/api/attendee/two-step-recovery/verify", { code: "518207" }))).json()).toEqual({ ok: true, setupRequired: false });
  });

  it("answers a body that is not JSON with 400, not 500", async () => {
    const request = new Request(`${ORIGIN}/api/attendee/two-step-recovery/verify`, { method: "POST", headers: { origin: ORIGIN }, body: "not json" });
    expect((await VERIFY(request)).status).toBe(400);
  });

  it("refuses what is not six digits without checking it", async () => {
    for (const code of ["12345", "1234567", "abcdef", "", "518-207"]) {
      expect((await VERIFY(post("/api/attendee/two-step-recovery/verify", { code }))).status).toBe(400);
    }
    expect((await VERIFY(post("/api/attendee/two-step-recovery/verify", { code: "518207", extra: 1 }))).status).toBe(400);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("answers a wrong code and a spent code in plain words, and sends no notice", async () => {
    mocks.complete.mockResolvedValueOnce({ ok: false, reason: "WRONG_CODE", attemptsLeft: 3 });
    const wrong = await VERIFY(post("/api/attendee/two-step-recovery/verify", { code: "111111" }));
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: "INVALID_CODE", message: "That code didn't work. Check the latest email, or send a new code." });
    mocks.complete.mockResolvedValueOnce({ ok: false, reason: "NO_LIVE_CODE" });
    const expired = await VERIFY(post("/api/attendee/two-step-recovery/verify", { code: "111111" }));
    expect(await expired.json()).toEqual({ error: "CODE_EXPIRED", message: "That code has expired or was already used. Send a new code." });
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});

describe("POST /api/attendee/sessions/sign-out-others", () => {
  it("needs the person's own attendee session and a same-origin request", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account, via: "staff", sessionId: null });
    expect((await SIGN_OUT_OTHERS(post("/api/attendee/sessions/sign-out-others"))).status).toBe(401);
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    expect((await SIGN_OUT_OTHERS(post("/api/attendee/sessions/sign-out-others"))).status).toBe(403);
    expect(mocks.signOutOthers).not.toHaveBeenCalled();
  });

  it("is rate limited before it changes anything", async () => {
    mocks.needsSignInStep.mockResolvedValue("OK");
    mocks.signOutRateLimit.mockResolvedValue(limited);
    expect((await SIGN_OUT_OTHERS(post("/api/attendee/sessions/sign-out-others"))).status).toBe(429);
    expect(mocks.signOutOthers).not.toHaveBeenCalled();
  });

  it("refuses a session that still owes its sign-in step, so a password alone cannot kick the owner off", async () => {
    for (const step of ["VERIFY", "EMAIL_CODE"]) {
      mocks.needsSignInStep.mockResolvedValue(step);
      const response = await SIGN_OUT_OTHERS(post("/api/attendee/sessions/sign-out-others"));
      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("SECOND_STEP_REQUIRED");
    }
    expect(mocks.signOutRateLimit).not.toHaveBeenCalled();
    expect(mocks.signOutOthers).not.toHaveBeenCalled();
  });

  it("keeps this session, signs the others out, audits ids and the count, and returns the new list", async () => {
    mocks.needsSignInStep.mockResolvedValue("OK");
    const response = await SIGN_OUT_OTHERS(post("/api/attendee/sessions/sign-out-others"));
    expect(mocks.signOutOthers).toHaveBeenCalledWith("account-1", "session-1");
    expect(mocks.writeAuditLog).toHaveBeenCalledWith({
      action: "ATTENDEE_SIGNED_OUT_OTHER_SESSIONS",
      entityType: "AttendeeAccount",
      entityId: "account-1",
      summary: "An attendee signed out their other devices.",
      metadata: { actorAttendeeAccountId: "account-1", sessionId: "session-1", revokedSessions: 2 },
    });
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, revoked: 2 });
    expect(body.sessions).toHaveLength(1);
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toContain("director@");
  });
});
