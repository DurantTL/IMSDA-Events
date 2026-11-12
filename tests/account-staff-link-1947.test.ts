import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/** #1947: the account portal's staff link and the "staff sign-in ended" notice. Synthetic data only. */
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }), unstable_rethrow: () => {} }));

import { AccountHeaderActions } from "@/components/account-header-actions";
import {
  StaffSignInEndedNotice,
  noticeAlreadySeen,
  recordNoticeSeen,
} from "@/components/staff-signin-ended-notice";
import { accountSignOutMode, otherWorkspaceContextsForAttendee } from "@/modules/access/workspace-contexts";
import { staffEndedMarkerFrom } from "@/modules/account-merge/staff-timeout";

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
    expect(html).not.toContain("Staff sign-in");
  });

  it("staff side ended: Staff sign-in to /sign-in?staff=1, no Staff workspace", () => {
    const html = topBar({ staffSession: false, staffSignInEnded: true });
    expect(html).toContain("Staff sign-in");
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
  it("changes with the newest staff session and is opaque", () => {
    const a = staffEndedMarkerFrom("user-1", new Date("2026-11-12T10:00:00Z"));
    const b = staffEndedMarkerFrom("user-1", new Date("2026-11-12T12:00:00Z"));
    expect(a).not.toBe(b);
    expect(a).toBe(staffEndedMarkerFrom("user-1", new Date("2026-11-12T10:00:00Z")));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(staffEndedMarkerFrom("user-1", null)).toMatch(/^[0-9a-f]{16}$/);
  });
});
