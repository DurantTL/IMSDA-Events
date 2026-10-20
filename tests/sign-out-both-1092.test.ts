import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1092: with one sign-in on, either sign-out route ends both of this browser's
 * sessions; with it off each route behaves as before. A linked person whose staff
 * side timed out is detected from their own attendee session and its link.
 * Synthetic data only.
 */
const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  getCurrentSession: vi.fn(),
  getCurrentAttendee: vi.fn(),
  cookies: new Map<string, string>(),
  cookieSet: vi.fn(),
  revokeStaff: vi.fn(),
  revokeAttendee: vi.fn(),
  revokeAll: vi.fn(),
  revokeOthers: vi.fn(),
  revokeAllAttendee: vi.fn(),
  endActAs: vi.fn(),
  userFindFirst: vi.fn(),
  order: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => (mocks.cookies.has(name) ? { value: mocks.cookies.get(name) } : undefined), set: mocks.cookieSet })),
}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ user: { findFirst: mocks.userFindFirst } }) }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: <T,>(handler: T) => handler }));
vi.mock("@/modules/account-merge/account-link", () => ({ isUnifiedSignInEnabled: mocks.enabled }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/access/session-store", () => ({
  SESSION_COOKIE_NAME: "imsda_session",
  revokeDatabaseSession: mocks.revokeStaff,
  revokeAllUserSessions: mocks.revokeAll,
  revokeOtherUserSessions: mocks.revokeOthers,
}));
vi.mock("@/modules/attendee-accounts/session-store", () => ({
  ATTENDEE_SESSION_COOKIE_NAME: "imsda_attendee_session",
  ATTENDEE_PENDING_COOKIE_NAME: "imsda_attendee_pending",
  revokeAttendeeSession: mocks.revokeAttendee,
  revokeAllAttendeeSessions: mocks.revokeAllAttendee,
}));
vi.mock("@/modules/organizations/staff-act-as", () => ({ endActiveActAsOnSignOut: mocks.endActAs }));

import { POST as staffLogout } from "@/app/api/auth/logout/route";
import { POST as attendeeSignOut } from "@/app/api/attendee/sign-out/route";
import { isStaffSessionTimedOutForLinkedAttendee } from "@/modules/account-merge/staff-timeout";

const post = (path: string) => new Request(`https://events.imsda.test${path}`, { method: "POST" });
const clearedNames = () => mocks.cookieSet.mock.calls.filter(([, value, options]) => value === "" && options?.maxAge === 0).map(([name]) => name).sort();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  mocks.cookies = new Map([["imsda_session", "staff-token"], ["imsda_attendee_session", "attendee-token"]]);
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "u1" }, sessionId: "staff-session-1" });
  mocks.endActAs.mockImplementation(async () => { mocks.order.push("act-as"); });
  mocks.revokeStaff.mockImplementation(async () => { mocks.order.push("revoke-staff"); });
});

describe("sign-out with one sign-in ON", () => {
  beforeEach(() => { mocks.enabled.mockResolvedValue(true); });

  it("staff sign-out revokes both sessions, clears both cookie sets, and ends act-as first", async () => {
    expect((await staffLogout(post("/api/auth/logout"))).status).toBe(200);
    expect(mocks.endActAs).toHaveBeenCalledWith("staff-session-1");
    expect(mocks.revokeStaff).toHaveBeenCalledWith("staff-token");
    expect(mocks.revokeAttendee).toHaveBeenCalledWith("attendee-token");
    expect(mocks.order).toEqual(["act-as", "revoke-staff"]);
    expect(clearedNames()).toEqual(["imsda_attendee_pending", "imsda_attendee_session", "imsda_session"]);
  });

  it("attendee sign-out revokes both sessions, clears both cookie sets, and ends act-as first", async () => {
    expect((await attendeeSignOut(post("/api/attendee/sign-out"))).status).toBe(200);
    expect(mocks.endActAs).toHaveBeenCalledWith("staff-session-1");
    expect(mocks.revokeStaff).toHaveBeenCalledWith("staff-token");
    expect(mocks.revokeAttendee).toHaveBeenCalledWith("attendee-token");
    expect(mocks.order).toEqual(["act-as", "revoke-staff"]);
    expect(clearedNames()).toEqual(["imsda_attendee_pending", "imsda_attendee_session", "imsda_session"]);
  });

  it("revokes only the tokens this browser holds, never by user or account", async () => {
    await staffLogout(post("/api/auth/logout"));
    await attendeeSignOut(post("/api/attendee/sign-out"));
    expect(mocks.revokeStaff.mock.calls).toEqual([["staff-token"], ["staff-token"]]);
    expect(mocks.revokeAttendee.mock.calls).toEqual([["attendee-token"], ["attendee-token"]]);
    expect(mocks.revokeAll).not.toHaveBeenCalled();
    expect(mocks.revokeOthers).not.toHaveBeenCalled();
    expect(mocks.revokeAllAttendee).not.toHaveBeenCalled();
  });

  it("an act-as failure does not stop the sign-out: both revokes run and every cookie is cleared", async () => {
    mocks.endActAs.mockRejectedValue(new Error("boom"));
    const response = await staffLogout(post("/api/auth/logout"));
    expect(response.status).toBe(200);
    expect(mocks.revokeStaff).toHaveBeenCalledWith("staff-token");
    expect(mocks.revokeAttendee).toHaveBeenCalledWith("attendee-token");
    expect(clearedNames()).toEqual(["imsda_attendee_pending", "imsda_attendee_session", "imsda_session"]);
  });

  it("a failed staff revoke still revokes the attendee side, clears every cookie, then answers 500", async () => {
    mocks.revokeStaff.mockRejectedValue(new Error("boom"));
    const response = await attendeeSignOut(post("/api/attendee/sign-out"));
    expect(response.status).toBe(500);
    expect(mocks.revokeAttendee).toHaveBeenCalledWith("attendee-token");
    expect(clearedNames()).toEqual(["imsda_attendee_pending", "imsda_attendee_session", "imsda_session"]);
  });

  it("with no staff cookie it still ends the attendee side and does not touch act-as", async () => {
    mocks.cookies.delete("imsda_session");
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    await attendeeSignOut(post("/api/attendee/sign-out"));
    expect(mocks.endActAs).not.toHaveBeenCalled();
    expect(mocks.revokeAttendee).toHaveBeenCalledWith("attendee-token");
  });
});

describe("sign-out with one sign-in OFF", () => {
  beforeEach(() => { mocks.enabled.mockResolvedValue(false); });

  it("staff sign-out ends only the staff session", async () => {
    await staffLogout(post("/api/auth/logout"));
    expect(mocks.endActAs).toHaveBeenCalledWith("staff-session-1");
    expect(mocks.revokeStaff).toHaveBeenCalledWith("staff-token");
    expect(mocks.revokeAttendee).not.toHaveBeenCalled();
    expect(clearedNames()).toEqual(["imsda_session"]);
  });

  it("attendee sign-out ends only the attendee session", async () => {
    await attendeeSignOut(post("/api/attendee/sign-out"));
    expect(mocks.revokeAttendee).toHaveBeenCalledWith("attendee-token");
    expect(mocks.revokeStaff).not.toHaveBeenCalled();
    expect(mocks.endActAs).not.toHaveBeenCalled();
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
    expect(clearedNames()).toEqual(["imsda_attendee_pending", "imsda_attendee_session"]);
  });

  it("an unreadable switch counts as off", async () => {
    mocks.enabled.mockRejectedValue(new Error("database unavailable"));
    await attendeeSignOut(post("/api/attendee/sign-out"));
    expect(mocks.revokeStaff).not.toHaveBeenCalled();
    expect(mocks.revokeAttendee).toHaveBeenCalledWith("attendee-token");
  });
});

describe("the timed-out staff side", () => {
  beforeEach(() => {
    mocks.enabled.mockResolvedValue(true);
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "acct-1", verifiedEmail: "a@example.test", displayName: "A" }, via: "attendee", sessionId: "s1" });
    mocks.userFindFirst.mockResolvedValue({ id: "u1" });
  });

  it("is true for a live attendee session linked to a staff user with no staff session, read via the link", async () => {
    expect(await isStaffSessionTimedOutForLinkedAttendee()).toBe(true);
    expect(mocks.userFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { attendeeAccountId: "acct-1", accountStatus: "ACTIVE" } }));
  });

  it("is false for an anonymous visitor, without any lookup", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect(await isStaffSessionTimedOutForLinkedAttendee()).toBe(false);
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
  });

  it("is false for an attendee who is not linked to staff", async () => {
    mocks.userFindFirst.mockResolvedValue(null);
    expect(await isStaffSessionTimedOutForLinkedAttendee()).toBe(false);
  });

  it("is false while a staff session is alive, with the switch off, and on any failure", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u1" } });
    expect(await isStaffSessionTimedOutForLinkedAttendee()).toBe(false);
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    mocks.enabled.mockResolvedValue(false);
    expect(await isStaffSessionTimedOutForLinkedAttendee()).toBe(false);
    mocks.enabled.mockResolvedValue(true);
    mocks.userFindFirst.mockRejectedValue(new Error("boom"));
    expect(await isStaffSessionTimedOutForLinkedAttendee()).toBe(false);
  });

  it("is false when the attendee side is only derived from a staff session", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "acct-1", verifiedEmail: "a@example.test", displayName: "A" }, via: "staff", sessionId: null });
    expect(await isStaffSessionTimedOutForLinkedAttendee()).toBe(false);
  });
});

describe("source pins", () => {
  it("the shared helper never revokes by user or account", () => {
    const text = readFileSync("modules/account-merge/sign-out.ts", "utf8");
    expect(text).not.toMatch(/revokeAll|revokeOther/);
  });

  it("the timeout notice never takes an email and /sign-in only shows it for the visitor's own session", () => {
    const helper = readFileSync("modules/account-merge/staff-timeout.ts", "utf8");
    expect(helper).not.toMatch(/where:\s*\{\s*email/);
    const page = readFileSync("app/sign-in/page.tsx", "utf8");
    expect(page).toContain("isStaffSessionTimedOutForLinkedAttendee()");
    expect(page).toContain("STAFF_TIMED_OUT_NOTICE");
  });

  it("both routes use the shared helper", () => {
    expect(readFileSync("app/api/auth/logout/route.ts", "utf8")).toContain('signOutThisBrowser("staff")');
    expect(readFileSync("app/api/attendee/sign-out/route.ts", "utf8")).toContain('signOutThisBrowser("attendee")');
  });
});
