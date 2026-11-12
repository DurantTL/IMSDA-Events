import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #835: the routes around visiting clubs. Every staff route is for system administrators and Clubs Administrators only:
 * an Area Coordinator or any other signed-in person gets 403 and a signed-out visitor 401, before the body is read and
 * before anything is called. The director's route needs their own signed-in account, the same origin and the rate limit.
 * Synthetic data only.
 */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  isClubsAdmin: vi.fn(),
  getCurrentSession: vi.fn(),
  getCurrentAttendee: vi.fn(),
  create: vi.fn(),
  cancel: vi.fn(),
  decide: vi.fn(),
  list: vi.fn(),
  submit: vi.fn(),
  submitLimit: vi.fn(),
  linkLimit: vi.fn(),
}));
vi.mock("@/modules/access/admin-roles", () => ({
  isActiveClubsAdministrator: mocks.isClubsAdmin,
  hasClubsAdministration: async (user: { id: string; globalRole?: string | null }) => user.globalRole === "SYSTEM_ADMIN" || mocks.isClubsAdmin(user.id),
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/access/request-security", () => ({
  rejectCrossOriginRequest: (request: Request) => (request.headers.get("origin") === "https://events.imsda.test" ? null : Response.json({ error: "INVALID_REQUEST_ORIGIN" }, { status: 403 })),
}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/rate-limit/service", () => ({
  checkVisitingClubSubmitRateLimit: mocks.submitLimit,
  checkVisitingClubLinkRateLimit: mocks.linkLimit,
}));
vi.mock("@/modules/visiting-clubs/repository", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createVisitingClubInvite: mocks.create,
  cancelVisitingClubInvite: mocks.cancel,
  decideVisitingClubRequest: mocks.decide,
  listVisitingClubInvites: mocks.list,
  submitVisitingClubRequest: mocks.submit,
}));
// The repository's own imports reach the database and outbox; the routes never call them here.
vi.mock("@/lib/prisma", () => ({ getPrisma: vi.fn() }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/communications/account-email", () => ({ isAccountEmailConfigured: () => true, getAccountEmailSender: vi.fn(), AccountEmailNotConfiguredError: class extends Error {} }));
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: vi.fn() }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.imsda.test" }) }));

import { VisitingClubError } from "@/modules/visiting-clubs/repository";
import { POST as sendInvite } from "@/app/api/admin/visiting-clubs/invites/route";
import { DELETE as cancelInvite } from "@/app/api/admin/visiting-clubs/invites/[inviteId]/route";
import { POST as decide } from "@/app/api/admin/visiting-clubs/requests/[requestId]/decision/route";
import { POST as submit } from "@/app/api/attendee/visiting-clubs/request/route";

const origin = { origin: "https://events.imsda.test", "content-type": "application/json" };
const allowed = { allowed: true, decisions: [] };
const inviteParams = { params: Promise.resolve({ inviteId: "inv-1" }) };
const requestParams = { params: Promise.resolve({ requestId: "req-1" }) };
const json = (body: unknown, headers: Record<string, string> = origin) => ({ method: "POST", headers, body: JSON.stringify(body) });

function staff(globalRole: "SYSTEM_ADMIN" | null, clubsAdmin = false) {
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-1", email: "staff@imsda-events.test", displayName: "Sam Staff", globalRole } });
  mocks.isClubsAdmin.mockResolvedValue(clubsAdmin);
}

const staffCalls = () => [
  () => sendInvite(new Request("https://events.imsda.test/api/admin/visiting-clubs/invites", json({ eventId: "event-1", email: "v@example.test" }))),
  () => cancelInvite(new Request("https://events.imsda.test/api/admin/visiting-clubs/invites/inv-1", { method: "DELETE", headers: origin }), inviteParams),
  () => decide(new Request("https://events.imsda.test/api/admin/visiting-clubs/requests/req-1/decision", json({ decision: "approve" })), requestParams),
];

const answers = { token: "synthetic-token", clubName: "Synthetic Eagles", clubType: "PATHFINDER", homeConference: "Synthetic Conference", homeChurch: "Synthetic Church", directorPhone: "(515) 555-0100", screeningConfirmed: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue({ user: null });
  mocks.isClubsAdmin.mockResolvedValue(false);
  mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
  mocks.list.mockResolvedValue([]);
  mocks.submitLimit.mockResolvedValue(allowed);
  mocks.linkLimit.mockResolvedValue(allowed);
  mocks.submit.mockResolvedValue({ id: "req-1" });
  mocks.decide.mockResolvedValue({ status: "APPROVED", organizationId: "org-1" });
});

describe("the staff routes", () => {
  it("refuse a signed-out visitor with 401 and call nothing", async () => {
    for (const call of staffCalls()) expect((await call()).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("refuse an Area Coordinator and any other staff member with 403 and call nothing", async () => {
    staff(null, false);
    for (const call of staffCalls()) expect((await call()).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("refuse a cross-origin request before anything else", async () => {
    staff("SYSTEM_ADMIN");
    const response = await sendInvite(new Request("https://events.imsda.test/api/admin/visiting-clubs/invites", json({ eventId: "event-1", email: "v@example.test" }, { origin: "https://evil.test", "content-type": "application/json" })));
    expect(response.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("let a system administrator and a Clubs Administrator send, withdraw and decide", async () => {
    for (const [role, clubs] of [["SYSTEM_ADMIN", false], [null, true]] as const) {
      staff(role, clubs);
      const sent = await staffCalls()[0]();
      expect(sent.status).toBe(201);
      expect((await staffCalls()[1]()).status).toBe(200);
      const decided = await staffCalls()[2]();
      expect(decided.status).toBe(200);
      expect(await decided.json()).toEqual({ id: "req-1", status: "APPROVED", organizationId: "org-1" });
    }
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.decide).toHaveBeenCalledTimes(2);
  });

  it("reject a bad body with 400 and a second decision with 409", async () => {
    staff("SYSTEM_ADMIN");
    const bad = await sendInvite(new Request("https://events.imsda.test/api/admin/visiting-clubs/invites", json({ email: "v@example.test" })));
    expect(bad.status).toBe(400);
    mocks.decide.mockRejectedValue(new VisitingClubError("ALREADY_DECIDED", "That request was already decided."));
    const again = await staffCalls()[2]();
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("ALREADY_DECIDED");
  });
});

describe("the director's route", () => {
  const call = (body: unknown = answers, headers: Record<string, string> = origin) => submit(new Request("https://events.imsda.test/api/attendee/visiting-clubs/request", json(body, headers)));
  const signedIn = () => mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "acct-1", verifiedEmail: "vera@example.test", displayName: "Vera Visitor" }, via: "attendee", sessionId: "s-1" });

  it("needs the person's own signed-in account: signed out is 401, and a staff member viewing an account is too", async () => {
    expect((await call()).status).toBe(401);
    mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "acct-1", verifiedEmail: "vera@example.test", displayName: "Vera" }, via: "staff", sessionId: null });
    expect((await call()).status).toBe(401);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request and a rate-limited one", async () => {
    signedIn();
    expect((await call(answers, { origin: "https://evil.test", "content-type": "application/json" })).status).toBe(403);
    mocks.submitLimit.mockResolvedValue({ allowed: false, decisions: [] });
    expect((await call()).status).toBe(429);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("passes the account's own id and verified email, never anything from the body", async () => {
    signedIn();
    const response = await call({ ...answers, directorEmail: "forged@example.test" });
    expect(response.status).toBe(400);
    expect((await call()).status).toBe(201);
    expect(mocks.submit).toHaveBeenCalledWith({ id: "acct-1", verifiedEmail: "vera@example.test", displayName: "Vera Visitor" }, "synthetic-token", expect.objectContaining({ clubName: "Synthetic Eagles" }));
  });

  it("answers an unticked screening box with 400 and a different address with 403", async () => {
    signedIn();
    expect((await call({ ...answers, screeningConfirmed: false })).status).toBe(400);
    mocks.submit.mockRejectedValue(new VisitingClubError("EMAIL_MISMATCH", "This link was sent to a different email address."));
    expect((await call()).status).toBe(403);
  });
});
