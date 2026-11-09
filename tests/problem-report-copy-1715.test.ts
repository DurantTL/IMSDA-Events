import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1715: the emailed copy of a problem report. The outbox, the rate limiter and the delivery worker are mocked; their own
 * rules have their own tests. Synthetic data only.
 */
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getCurrentAttendee: vi.fn(),
  checkRateLimit: vi.fn(),
  checkCopyRateLimit: vi.fn(),
  requireTurnstile: vi.fn(),
  reportCreate: vi.fn(),
  outboxCreate: vi.fn(),
  dispatchUnsuppressedAlert: vi.fn(),
  processQueue: vi.fn(),
  configured: vi.fn(),
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/lib/release", () => ({ getReleaseIdentity: () => ({ sha: "0123456789abcdef0123", buildId: null }) }));
vi.mock("@/modules/rate-limit/service", () => ({
  checkProblemReportRateLimit: mocks.checkRateLimit,
  checkProblemReportCopyRateLimit: mocks.checkCopyRateLimit,
}));
vi.mock("@/modules/security/turnstile", async () => {
  const actual = await vi.importActual<typeof import("@/modules/security/turnstile")>("@/modules/security/turnstile");
  return { ...actual, requireTurnstile: mocks.requireTurnstile, turnstileSiteKeyForPage: () => null };
});
vi.mock("@/modules/operations/alerting", () => ({ dispatchUnsuppressedAlert: mocks.dispatchUnsuppressedAlert }));
vi.mock("@/modules/communications/account-email", () => {
  class AccountEmailNotConfiguredError extends Error {}
  return {
    AccountEmailNotConfiguredError,
    isAccountEmailConfigured: mocks.configured,
    getAccountEmailSender: () => ({ name: "IMAdventist", address: "no-reply@events.imsda.test", replyTo: null }),
  };
});
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: mocks.processQueue }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({ problemReport: { create: mocks.reportCreate }, messageOutbox: { create: mocks.outboxCreate } }),
}));

import { POST } from "@/app/api/support/problem-reports/route";
import { problemReportCopyEmailContent } from "@/modules/support/problem-report-copy-content";

function post(body: unknown) {
  return new Request("https://events.imsda.test/api/support/problem-reports", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://events.imsda.test" },
    body: JSON.stringify(body),
  });
}
const base = {
  message: "The page froze after I pressed Submit.",
  website: "",
  details: {
    path: "/events/camp-meeting/register?name=Sam", userAgent: "Synthetic Browser/9.9", viewport: "390x844", language: "en-US",
    clientTime: "2026-11-08T12:00:00.000Z", securityCheckBlocked: true,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue({ user: null });
  mocks.getCurrentAttendee.mockResolvedValue({ account: null });
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, decisions: [] });
  mocks.checkCopyRateLimit.mockResolvedValue({ allowed: true, decisions: [] });
  // A verified request: the Security check accepted a real token.
  mocks.requireTurnstile.mockImplementation(async (_request: Request, options: { onVerified?: () => void }) => { options.onVerified?.(); return null; });
  mocks.reportCreate.mockResolvedValue({ id: "pr-1", number: 12 });
  mocks.outboxCreate.mockResolvedValue({ id: "msg-1" });
  mocks.dispatchUnsuppressedAlert.mockResolvedValue({ delivered: true, attempted: true });
  mocks.processQueue.mockResolvedValue({ sentIds: ["msg-1"], rescheduledIds: [] });
  mocks.configured.mockReturnValue(true);
});

describe("emailed copy of a problem report (#1715)", () => {
  it("sends a signed-in reporter a copy at the email the popup prefilled from their account", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-1", email: "pat@example.test" } });
    const response = await POST(post({ ...base, email: "pat@example.test" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ reference: "P-12", copy: "sent" });
    const data = mocks.outboxCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ templateKey: "PROBLEM_REPORT_COPY", recipientEmail: "pat@example.test", eventId: null, status: "PENDING", idempotencyKey: "problem-report-copy:pr-1" });
    expect(mocks.processQueue).toHaveBeenCalledWith({ messageIds: ["msg-1"], limit: 1 });
  });

  it("sends a signed-out reporter who typed an email a copy, lowercased", async () => {
    const response = await POST(post({ ...base, email: "Sam@Example.Test" }));
    expect(await response.json()).toEqual({ reference: "P-12", copy: "sent" });
    expect(mocks.outboxCreate.mock.calls[0][0].data.recipientEmail).toBe("sam@example.test");
    expect(mocks.checkCopyRateLimit.mock.calls[0][1]).toBe("sam@example.test");
  });

  it("sends nothing when no email was given", async () => {
    const response = await POST(post(base));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ reference: "P-12", copy: "skipped" });
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
    expect(mocks.checkCopyRateLimit).not.toHaveBeenCalled();
  });

  it("treats an invalid email as a bad report: nothing is saved or sent", async () => {
    const response = await POST(post({ ...base, email: "not-an-email" }));
    expect(response.status).toBe(400);
    expect(mocks.reportCreate).not.toHaveBeenCalled();
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });

  it("carries the reference and the person's words, and no page or technical details", async () => {
    await POST(post({ ...base, email: "sam@example.test" }));
    const data = mocks.outboxCreate.mock.calls[0][0].data;
    const all = `${data.subjectSnapshot}\n${data.bodyTextSnapshot}`;
    expect(all).toContain("P-12");
    expect(all).toContain(base.message);
    expect(all).not.toContain("/events/camp-meeting/register");
    for (const hidden of ["Synthetic Browser", "390x844", "en-US", "2026-11-08", "0123456789ab", "pr-1", "name=Sam", "Security check", "user-1"]) {
      expect(all).not.toContain(hidden);
    }
    expect(JSON.stringify(data.metadata)).not.toContain("Synthetic Browser");
  });

  it("never puts recent error ids in the emailed copy, though they are saved for the IT team", async () => {
    await POST(post({ ...base, email: "sam@example.test", details: { ...base.details, errorIds: ["1234567890", "987654321@E394"] } }));
    expect(mocks.reportCreate.mock.calls[0][0].data.details.errorIds).toEqual(["1234567890", "987654321@E394"]);
    const data = mocks.outboxCreate.mock.calls[0][0].data;
    const all = `${data.subjectSnapshot}\n${data.bodyTextSnapshot}\n${data.bodyHtmlSnapshot ?? ""}\n${JSON.stringify(data.metadata)}`;
    for (const id of ["1234567890", "987654321@E394", "Error id"]) expect(all).not.toContain(id);
  });

  it("builds the words as one escaped quote block with a quoted text part", () => {
    const content = problemReportCopyEmailContent({ reference: "P-7", message: "It <b>broke</b>.\n\nTwice." });
    expect(content.bodyText).toContain("What you wrote:\n\n> It <b>broke</b>.\n>\n> Twice.");
    expect(content.bodyHtml).toContain("It &lt;b&gt;broke&lt;/b&gt;.<br><br>Twice.</blockquote>");
    expect(content.bodyHtml).not.toContain("<b>");
  });

  it("sends no copy when the request was not verified: the #1480 fallback, or the check off", async () => {
    // Both end in requireTurnstile returning null without calling onVerified.
    mocks.requireTurnstile.mockResolvedValue(null);
    const response = await POST(post({ ...base, email: "sam@example.test" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ reference: "P-12", copy: "skipped" });
    expect(mocks.reportCreate).toHaveBeenCalledTimes(1);
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
    expect(mocks.checkCopyRateLimit).not.toHaveBeenCalled();
  });

  it("sends no copy for a report the rate limit or the Security check rejected", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false, decisions: [] });
    expect((await POST(post({ ...base, email: "sam@example.test" }))).status).toBe(429);
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, decisions: [] });
    mocks.requireTurnstile.mockResolvedValue(Response.json({ error: "security_check_failed" }, { status: 403 }));
    expect((await POST(post({ ...base, email: "sam@example.test" }))).status).toBe(403);
    expect(mocks.reportCreate).not.toHaveBeenCalled();
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });

  it("skips the copy, and still saves the report, when the site-wide cap is the limit that refuses", async () => {
    mocks.checkCopyRateLimit.mockResolvedValue({ allowed: false, decisions: [{ policy: "support.problem-report-copy.site-hour", allowed: false }] });
    const response = await POST(post({ ...base, email: "sam@example.test" }));
    expect(await response.json()).toEqual({ reference: "P-12", copy: "skipped" });
    expect(mocks.reportCreate).toHaveBeenCalledTimes(1);
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });

  it("still saves the report and skips the copy when the copy rate limit is hit", async () => {
    mocks.checkCopyRateLimit.mockResolvedValue({ allowed: false, decisions: [] });
    const response = await POST(post({ ...base, email: "sam@example.test" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ reference: "P-12", copy: "skipped" });
    expect(mocks.reportCreate).toHaveBeenCalledTimes(1);
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });

  it("still saves the report when account email is not configured or the outbox fails", async () => {
    mocks.configured.mockReturnValue(false);
    expect(await (await POST(post({ ...base, email: "sam@example.test" }))).json()).toEqual({ reference: "P-12", copy: "skipped" });
    mocks.configured.mockReturnValue(true);
    mocks.outboxCreate.mockRejectedValue(new Error("database down"));
    const response = await POST(post({ ...base, email: "sam@example.test" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ reference: "P-12", copy: "skipped" });
  });

  it("still reports a copy as queued when immediate delivery fails (the sweep retries)", async () => {
    mocks.processQueue.mockRejectedValue(new Error("provider down"));
    const response = await POST(post({ ...base, email: "sam@example.test" }));
    expect(await response.json()).toEqual({ reference: "P-12", copy: "sent" });
  });
});
