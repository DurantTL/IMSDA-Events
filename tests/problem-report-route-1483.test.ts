import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1483: the public problem report route and the IT team announcement. The database, the rate limiter and the Security check
 * are mocked; their own rules have their own tests. Synthetic data only.
 */
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getCurrentAttendee: vi.fn(),
  checkRateLimit: vi.fn(),
  requireTurnstile: vi.fn(),
  create: vi.fn(),
  dispatchUnsuppressedAlert: vi.fn(),
  count: vi.fn(),
  updateMany: vi.fn(),
  writeAuditLog: vi.fn(),
  sendCopy: vi.fn(),
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.imsda.test" }), isServerEnvironmentError: () => false }));
vi.mock("@/lib/release", () => ({ getReleaseIdentity: () => ({ sha: "0123456789abcdef0123", buildId: null }) }));
vi.mock("@/modules/rate-limit/service", () => ({ checkProblemReportRateLimit: mocks.checkRateLimit }));
vi.mock("@/modules/security/turnstile", async () => {
  const actual = await vi.importActual<typeof import("@/modules/security/turnstile")>("@/modules/security/turnstile");
  return { ...actual, requireTurnstile: mocks.requireTurnstile, turnstileSiteKeyForPage: () => "site-key-test" };
});
vi.mock("@/modules/support/problem-report-copy", () => ({ sendProblemReportCopy: mocks.sendCopy }));
vi.mock("@/modules/operations/alerting", () => ({ dispatchUnsuppressedAlert: mocks.dispatchUnsuppressedAlert }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/prisma", () => {
  const problemReport = { create: mocks.create, count: mocks.count, updateMany: mocks.updateMany };
  return { getPrisma: () => ({ problemReport, $transaction: (run: (tx: unknown) => unknown) => run({ problemReport }) }) };
});

import { GET, POST } from "@/app/api/support/problem-reports/route";
import { PATCH } from "@/app/api/admin/problem-reports/[reportId]/route";
import { problemReportAlertDetail } from "@/modules/support/problem-reports";

function post(body: unknown, origin: string | null = "https://events.imsda.test") {
  return new Request("https://events.imsda.test/api/support/problem-reports", {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
}
const valid = { message: "The page froze after I pressed Submit.", email: "sam@example.test", website: "", details: {
  path: "/events/camp-meeting/register?name=Sam&email=sam%40example.test", userAgent: "Synthetic Browser", viewport: "390x844",
  cookie: "session=SECRET-COOKIE", formData: { allergies: "SECRET-MEDICAL" },
} };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue({ user: null });
  mocks.getCurrentAttendee.mockResolvedValue({ account: null });
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, decisions: [] });
  mocks.requireTurnstile.mockResolvedValue(null);
  mocks.sendCopy.mockResolvedValue("skipped");
  mocks.create.mockResolvedValue({ id: "pr-1", number: 12 });
  mocks.dispatchUnsuppressedAlert.mockResolvedValue({ delivered: true, attempted: true });
});

describe("POST /api/support/problem-reports", () => {
  it("stores the report, answers with the reference and keeps only the listed details", async () => {
    const response = await POST(post(valid));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ reference: "P-12", copy: "skipped" });
    const data = mocks.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ message: valid.message, email: "sam@example.test", userId: null });
    const stored = JSON.stringify(data.details);
    expect(data.details.path).toBe("/events/camp-meeting/register");
    expect(data.details.appVersion).toBe("0123456789ab");
    for (const secret of ["SECRET-COOKIE", "SECRET-MEDICAL", "Sam&", "sam%40"]) expect(stored).not.toContain(secret);
  });

  it("stores no details when the box was off", async () => {
    await POST(post({ ...valid, details: null }));
    expect(mocks.create.mock.calls[0][0].data.details).toBeUndefined();
  });

  it("announces to the IT team with the reference and device facts, never the person's words or email", async () => {
    await POST(post(valid));
    const alert = mocks.dispatchUnsuppressedAlert.mock.calls[0][0];
    expect(alert.key).toBe("problem-report.12");
    expect(alert.summary).toContain("P-12");
    const sent = JSON.stringify(alert);
    expect(sent).not.toContain(valid.message);
    expect(sent).not.toContain("sam@example.test");
    expect(sent).toContain("/events/camp-meeting/register");
  });

  it("still saves and answers when the webhook is down", async () => {
    mocks.dispatchUnsuppressedAlert.mockRejectedValue(new Error("webhook down"));
    const response = await POST(post(valid));
    expect(response.status).toBe(201);
  });

  it("refuses a cross-origin request, a filled honeypot, a missing message and a bad email before any write", async () => {
    expect((await POST(post(valid, "https://evil.example"))).status).toBe(403);
    expect((await POST(post({ ...valid, website: "http://spam.example" }))).status).toBe(400);
    expect((await POST(post({ ...valid, message: " " }))).status).toBe(400);
    const badEmail = await POST(post({ ...valid, email: "nope" }));
    expect(badEmail.status).toBe(400);
    // The field name lets the popup show the message next to the email input.
    expect(await badEmail.json()).toMatchObject({ field: "email", message: "Enter a valid email address." });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("is rate limited before the Security check and before any write", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false, decisions: [] });
    const response = await POST(post(valid));
    expect(response.status).toBe(429);
    expect(mocks.requireTurnstile).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("writes nothing when the Security check refuses, and asks it with the problem-report action and the public-form fallback", async () => {
    mocks.requireTurnstile.mockResolvedValue(Response.json({ error: "security_check_failed" }, { status: 403 }));
    const response = await POST(post(valid));
    expect(response.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.requireTurnstile.mock.calls[0][1]).toEqual({ action: "problem-report", fallback: { kind: "public-form", email: "sam@example.test" }, onVerified: expect.any(Function) });
  });

  it("links a signed-in staff user to the report by id only", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-1", email: "staff@example.test" } });
    await POST(post(valid));
    expect(mocks.create.mock.calls[0][0].data.userId).toBe("user-1");
  });
});

describe("GET /api/support/problem-reports", () => {
  it("gives the site key and the signed-in email, nothing else", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-1", email: "staff@example.test" } });
    expect(await (await GET(new Request("https://events.imsda.test/api/support/problem-reports"))).json()).toEqual({ siteKey: "site-key-test", email: "staff@example.test" });
  });
  it("prefills a signed-in attendee's email", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "a1", verifiedEmail: "attendee@example.test", displayName: "Alex Example" } });
    expect((await (await GET(new Request("https://events.imsda.test/api/support/problem-reports"))).json()).email).toBe("attendee@example.test");
  });
  it("gives no email when nobody is signed in", async () => {
    expect((await (await GET(new Request("https://events.imsda.test/api/support/problem-reports"))).json()).email).toBeNull();
  });
});

describe("PATCH /api/admin/problem-reports/[reportId]", () => {
  const context = { params: Promise.resolve({ reportId: "pr-1" }) };
  const patch = () => new Request("https://events.imsda.test/api/admin/problem-reports/pr-1", { method: "PATCH", headers: { origin: "https://events.imsda.test" } });
  it("refuses a signed-out visitor and a non-administrator", async () => {
    expect((await PATCH(patch(), context)).status).toBe(401);
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u", globalRole: null } });
    expect((await PATCH(patch(), context)).status).toBe(403);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it("lets a system administrator complete an open report once", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
    mocks.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect((await PATCH(patch(), context)).status).toBe(200);
    expect(mocks.updateMany.mock.calls[0][0].where).toEqual({ id: "pr-1", status: "OPEN" });
    expect((await PATCH(patch(), context)).status).toBe(404);
    // Audited once, with ids only.
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    const entry = mocks.writeAuditLog.mock.calls[0][0];
    expect(entry).toMatchObject({ action: "PROBLEM_REPORT_COMPLETED", entityType: "ProblemReport", entityId: "pr-1", actorUserId: "admin-1", metadata: { reportId: "pr-1" } });
  });
});

describe("the IT team line", () => {
  it("adds recent error ids to the line for the IT team, and nothing when there are none (#1715)", () => {
    expect(problemReportAlertDetail({ path: "/sign-in", errorIds: ["111", "222@E394"] })).toContain("Error ids 111, 222@E394");
    expect(problemReportAlertDetail({ path: "/sign-in" })).not.toContain("Error ids");
  });

  it("holds device and page facts only", () => {
    const line = problemReportAlertDetail({ path: "/sign-in", userAgent: "Synthetic Browser", translation: "on", securityCheckBlocked: true, appVersion: "abc123" });
    expect(line).toContain("Page /sign-in");
    expect(line).toContain("Page translated");
    expect(line).toContain("Security check did not load");
    expect(line).toContain("Version abc123");
    expect(problemReportAlertDetail(null)).toBe("No technical details were included.");
  });
});
