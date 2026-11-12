import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1947: the account portal's staff link and the "staff sign-in ended" notice. Synthetic data only. */
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({
  cookie: vi.fn(),
  enabled: vi.fn(),
  staff: vi.fn(),
  attendee: vi.fn(),
  findSession: vi.fn(),
  findUser: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/modules/security/session-cookies", () => ({ staffSessionCookie: { read: m.cookie } }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ userSession: { findUnique: m.findSession }, user: { findFirst: m.findUser } }) }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: m.staff }));
vi.mock("@/modules/account-merge/account-link", () => ({ isUnifiedSignInEnabled: m.enabled }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: m.attendee }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }), unstable_rethrow: () => {} }));

import { AccountHeaderActions } from "@/components/account-header-actions";
import {
  StaffSignInEndedNotice,
  dismissNotice,
  isNoticeVisible,
  noticeAlreadySeen,
  recordNoticeSeen,
} from "@/components/staff-signin-ended-notice";
import { accountSignOutMode, otherWorkspaceContextsForAttendee } from "@/modules/access/workspace-contexts";
import { staffEndedMarkerFrom, staffSignInEndedMarker } from "@/modules/account-merge/staff-timeout";

function topBar(input: { staffSession: boolean; staffSignInEnded: boolean }) {
  const contexts = otherWorkspaceContextsForAttendee({ hasStaffSession: input.staffSession, isSystemAdmin: false });
  const signOut = accountSignOutMode({ hasAttendeeAccount: true, hasStaffSession: input.staffSession, actingAsClubRole: false });
  return renderToStaticMarkup(createElement(AccountHeaderActions, { contexts, signOut, identity: "Sam Sample", staffSignInEnded: input.staffSignInEnded }));
}

describe("account portal top bar staff link (#1947)", () => {
  it("staff signed in: Staff workspace to /home, no Staff sign-in", () => {
    const html = topBar({ staffSession: true, staffSignInEnded: false });
    expect(html).toContain("Staff workspace");
    expect(html).toContain('href="/home"');
    expect(html).toContain('aria-label="Staff workspace"');
    expect(html).not.toContain("Staff sign-in");
  });

  it("staff side ended: Staff sign-in to /sign-in?staff=1, no Staff workspace", () => {
    const html = topBar({ staffSession: false, staffSignInEnded: true });
    expect(html).toContain("Staff sign-in");
    expect(html).toContain('aria-label="Staff sign-in"');
    expect(html).toContain('href="/sign-in?staff=1"');
    expect(html).not.toContain("Staff workspace");
  });

  it("no staff link: neither link", () => {
    const html = topBar({ staffSession: false, staffSignInEnded: false });
    expect(html).not.toContain("Staff sign-in");
    expect(html).not.toContain("Staff workspace");
  });
});

describe("staff sign-in ended notice (#1947)", () => {
  it("renders the text, a Staff sign-in link and a labelled dismiss button as a status", () => {
    const html = renderToStaticMarkup(createElement(StaffSignInEndedNotice, { marker: "abc" }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Your staff sign-in ended. Sign in again to get back to the staff workspace.");
    expect(html).toContain('href="/sign-in?staff=1"');
    expect(html).toContain("Staff sign-in");
    expect(html).toContain('aria-label="Dismiss the staff sign-in notice"');
  });

  it("is shown once per marker", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    expect(noticeAlreadySeen(storage, "m1")).toBe(false);
    recordNoticeSeen(storage, "m1");
    expect(noticeAlreadySeen(storage, "m1")).toBe(true);
    expect(noticeAlreadySeen(storage, "m2")).toBe(false);
  });

  it("still works when storage fails or is missing", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(noticeAlreadySeen(broken, "m1")).toBe(false);
    expect(() => recordNoticeSeen(broken, "m1")).not.toThrow();
    expect(noticeAlreadySeen(null, "m1")).toBe(false);
    expect(() => recordNoticeSeen(null, "m1")).not.toThrow();
  });
});

describe("staff sign-out marker (#1947)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.enabled.mockResolvedValue(true);
    m.staff.mockResolvedValue({ user: null });
    m.attendee.mockResolvedValue({ account: { id: "acct-1" }, via: "attendee" });
    m.cookie.mockReturnValue("synthetic-token");
    m.findSession.mockResolvedValue({ id: "sess-1", userId: "user-1" });
    m.findUser.mockResolvedValue({ id: "user-1" });
  });

  it("is a short opaque hash of the session id", () => {
    expect(staffEndedMarkerFrom("sess-1")).toMatch(/^[0-9a-f]{16}$/);
    expect(staffEndedMarkerFrom("sess-1")).not.toBe(staffEndedMarkerFrom("sess-2"));
  });

  it("is the hash of this browser's own ended session when it belongs to the linked user", async () => {
    expect(await staffSignInEndedMarker()).toBe(staffEndedMarkerFrom("sess-1"));
  });

  it("is null with no staff cookie", async () => {
    m.cookie.mockReturnValue(null);
    expect(await staffSignInEndedMarker()).toBeNull();
  });

  it("is null when the cookie has no session row", async () => {
    m.findSession.mockResolvedValue(null);
    expect(await staffSignInEndedMarker()).toBeNull();
  });

  it("is null when the cookie's session belongs to another user", async () => {
    m.findSession.mockResolvedValue({ id: "sess-9", userId: "user-2" });
    expect(await staffSignInEndedMarker()).toBeNull();
  });
});

describe("staff sign-in ended notice remount (#1947)", () => {
  it("stays hidden after Dismiss when the page is shown again, and the key is stored", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    expect(isNoticeVisible(storage, "remount")).toBe(true);
    recordNoticeSeen(storage, "remount"); // first display records the key; the same view stays visible
    expect(isNoticeVisible(storage, "remount")).toBe(true);
    dismissNotice(storage, "remount");
    expect(isNoticeVisible(storage, "remount")).toBe(false); // tab away and back: still hidden
    expect(noticeAlreadySeen(storage, "remount")).toBe(true); // a reload stays hidden too
  });
});
