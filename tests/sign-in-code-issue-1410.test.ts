import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkSend: vi.fn(),
  begin: vi.fn(),
  queue: vi.fn(),
  deliver: vi.fn(),
  after: vi.fn(),
  mint: vi.fn(),
  bind: vi.fn(),
  needsStep: vi.fn(),
  sessionFind: vi.fn(),
  accountFind: vi.fn(),
  logError: vi.fn(),
  getCurrentAttendee: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
  hasPending: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/logger", () => ({ logError: mocks.logError, logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ attendeeSession: { findUnique: mocks.sessionFind }, attendeeAccount: { findUnique: mocks.accountFind } }) }));
vi.mock("@/modules/rate-limit/service", () => ({ checkAttendeeSignInCodeSendRateLimit: mocks.checkSend }));
vi.mock("@/modules/attendee-accounts/sign-in-code-service", () => ({
  beginAttendeeSignInCode: mocks.begin,
  hasPendingAttendeeSignInCode: mocks.hasPending,
}));
vi.mock("@/modules/attendee-accounts/attendee-email-dispatch", () => ({
  queueAttendeeSignInCodeEmail: mocks.queue,
  deliverQueuedAttendeeEmail: mocks.deliver,
}));
vi.mock("@/modules/attendee-accounts/attendee-email", () => ({ mintAttendeeCodeWithoutSending: mocks.mint }));
vi.mock("@/modules/attendee-accounts/step-up-service", () => ({ bindAttendeeStepUpMessage: mocks.bind }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSignInStep: mocks.needsStep }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/components/attendee-sign-out-button", () => ({ AttendeeSignOutButton: () => null }));
vi.mock("@/components/sign-in-code-form", () => ({ SignInCodeForm: () => null }));

import SignInCodePage from "@/app/(public)/account/sign-in/code/page";
import { issueSignInCode, startSignInCodeIfRequired } from "@/modules/attendee-accounts/sign-in-code-issue";

const request = new Request("https://events.imsda.test/api/attendee/sign-in", { method: "POST" });
const allowed = { allowed: true, decisions: [] };
const base = { request, accountId: "account-1", sessionId: "session-1", email: "director@imsda-events.test", displayName: "Test Director" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.checkSend.mockResolvedValue(allowed);
  mocks.begin.mockResolvedValue({ id: "code-1", expiresAt: new Date() });
  mocks.queue.mockResolvedValue({ configured: true, messageId: "msg-1" });
  mocks.sessionFind.mockResolvedValue({ id: "session-1" });
  mocks.accountFind.mockResolvedValue({ email: "director@imsda-events.test", displayName: "Test Director" });
  mocks.needsStep.mockResolvedValue("EMAIL_CODE");
});

describe("issueSignInCode", () => {
  it("checks the send budget first, and sends nothing when it says no", async () => {
    mocks.checkSend.mockResolvedValue({ allowed: false, decisions: [] });
    await expect(issueSignInCode(base)).resolves.toMatchObject({ sent: false, rateLimited: true });
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("retires earlier codes, queues the email and delivers it after the response", async () => {
    await expect(issueSignInCode(base)).resolves.toMatchObject({ sent: true, rateLimited: false });
    expect(mocks.begin).toHaveBeenCalledWith("account-1", "session-1");
    expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account-1", stepUpCodeId: "code-1" }));
    const [deliverLater] = mocks.after.mock.calls[0] as [() => void];
    deliverLater();
    expect(mocks.deliver).toHaveBeenCalledWith("msg-1");
  });

  it("production with no email configured sends nothing and mints nothing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.queue.mockResolvedValue({ configured: false, messageId: null });
    await expect(issueSignInCode(base)).resolves.toMatchObject({ sent: false });
    expect(mocks.mint).not.toHaveBeenCalled();
  });

  it("development with no email configured hands back the code, as the edit code does", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mocks.queue.mockResolvedValue({ configured: false, messageId: null });
    mocks.mint.mockResolvedValue("518207");
    await expect(issueSignInCode(base)).resolves.toMatchObject({ sent: true, developmentCode: "518207" });
    expect(mocks.mint).toHaveBeenCalledWith(expect.objectContaining({ purpose: "sign-in-code" }));
  });
});

describe("startSignInCodeIfRequired", () => {
  const input = { request, accountId: "account-1", sessionToken: "token-1" };

  it("asks only the sessions that owe the code, and says nothing for the rest", async () => {
    mocks.needsStep.mockResolvedValue("OK");
    await expect(startSignInCodeIfRequired(input)).resolves.toEqual({ required: false });
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("does not send to a session that must verify with its authenticator or passkey instead", async () => {
    mocks.needsStep.mockResolvedValue("VERIFY");
    await expect(startSignInCodeIfRequired(input)).resolves.toEqual({ required: false });
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("sends for the new session and reports it", async () => {
    await expect(startSignInCodeIfRequired(input)).resolves.toEqual({ required: true, sent: true, developmentCode: undefined });
    expect(mocks.needsStep).toHaveBeenCalledWith("account-1", "session-1");
  });

  it("a failed gate lookup is logged with ids only and the sign-in proceeds: the session gate still sends them to the code page", async () => {
    mocks.needsStep.mockRejectedValue(new Error("database down"));
    await expect(startSignInCodeIfRequired(input)).resolves.toEqual({ required: false });
    expect(mocks.queue).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledWith(expect.any(String), expect.any(Error), { accountId: "account-1" });
    mocks.needsStep.mockResolvedValue("EMAIL_CODE");
    mocks.sessionFind.mockRejectedValue(new Error("database down"));
    await expect(startSignInCodeIfRequired(input)).resolves.toEqual({ required: false });
  });

  it("a failed send still reports the code as owed: the session is gated, so nothing opens", async () => {
    mocks.queue.mockRejectedValue(new Error("outbox down"));
    await expect(startSignInCodeIfRequired(input)).resolves.toEqual({ required: true, sent: false });
    expect(mocks.logError).toHaveBeenCalled();
  });
});

describe("the code page", () => {
  const page = (next?: string) => SignInCodePage({ searchParams: Promise.resolve({ next }) });

  it("sends a signed-out visitor to sign-in", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    await expect(page()).rejects.toThrow("REDIRECT:/account/sign-in");
  });

  it("sends a session that owes nothing on to where it was going, and one with two-step to confirm it", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "account-1", verifiedEmail: "d@imsda-events.test" }, via: "attendee", sessionId: "session-1" });
    mocks.needsStep.mockResolvedValue("OK");
    await expect(page("/account/registrations")).rejects.toThrow("REDIRECT:/account/registrations");
    mocks.needsStep.mockResolvedValue("VERIFY");
    await expect(page("/account/registrations")).rejects.toThrow(`REDIRECT:/account/two-step?next=${encodeURIComponent("/account/registrations")}`);
  });

  it("never sends a code just because the page was opened", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "account-1", verifiedEmail: "d@imsda-events.test" }, via: "attendee", sessionId: "session-1" });
    mocks.hasPending.mockResolvedValue(false);
    await page();
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });
});
