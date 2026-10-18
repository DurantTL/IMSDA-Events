import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }), unstable_rethrow: () => {} }));

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getCurrentAttendee: vi.fn(),
  isUnifiedSignInEnabled: vi.fn(),
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/account-merge/account-link", () => ({ isUnifiedSignInEnabled: mocks.isUnifiedSignInEnabled }));

import { AccountHeaderActions } from "@/components/account-header-actions";
import { PublicHeaderLinks } from "@/components/public-header-links";
import { PublicHeaderSessionLinks } from "@/components/public-header-session-links";
import { accountSignOutMode, otherWorkspaceContextsForAttendee, type AccountSignOutMode } from "@/modules/access/workspace-contexts";
import { postAccountSignOut } from "@/modules/attendee-accounts/sign-out-requests";

// Synthetic data only.
const render = (props: Parameters<typeof PublicHeaderLinks>[0]) => renderToStaticMarkup(createElement(PublicHeaderLinks, props));

describe("public header links (#1009)", () => {
  it("signed out, switch off: Sign in goes to the attendee sign-in page", () => {
    const html = render({ staffSignedIn: false, attendeeSignedIn: false, unifiedSignInEnabled: false });
    expect(html).toContain('href="/account/sign-in"');
    expect(html).toContain("Sign in");
    expect(html).not.toContain("Staff workspace");
    expect(html).not.toContain("My account");
  });

  it("signed out, switch on: Sign in goes to /sign-in", () => {
    const html = render({ staffSignedIn: false, attendeeSignedIn: false, unifiedSignInEnabled: true });
    expect(html).toContain('href="/sign-in"');
    expect(html).not.toContain('href="/login"');
  });

  it("attendee: My account, no Sign in", () => {
    const html = render({ staffSignedIn: false, attendeeSignedIn: true, unifiedSignInEnabled: true });
    expect(html).toContain('href="/account"');
    expect(html).toContain("My account");
    expect(html).not.toContain("Sign in");
    expect(html).not.toContain("Staff workspace");
  });

  it("staff: Staff workspace, no Sign in", () => {
    const html = render({ staffSignedIn: true, attendeeSignedIn: false, unifiedSignInEnabled: false });
    expect(html).toContain('href="/overview"');
    expect(html).toContain("Staff workspace");
    expect(html).not.toContain("Sign in");
    expect(html).not.toContain("My account");
  });
});

describe("PublicHeaderSessionLinks (#1009)", () => {
  beforeEach(() => {
    mocks.getCurrentSession.mockReset().mockResolvedValue({ user: null });
    mocks.getCurrentAttendee.mockReset().mockResolvedValue({ account: null, via: null, sessionId: null });
    mocks.isUnifiedSignInEnabled.mockReset().mockResolvedValue(false);
  });
  const html = async () => renderToStaticMarkup(await PublicHeaderSessionLinks());

  it("reads the switch: on goes to /sign-in", async () => {
    mocks.isUnifiedSignInEnabled.mockResolvedValue(true);
    expect(await html()).toContain('href="/sign-in"');
  });

  it("a failure to read the switch counts as off", async () => {
    mocks.isUnifiedSignInEnabled.mockRejectedValue(new Error("database down"));
    expect(await html()).toContain('href="/account/sign-in"');
  });

  it("does not read the switch for a signed-in visitor", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "acct_1" }, via: "attendee", sessionId: "s1" });
    const out = await html();
    expect(out).toContain("My account");
    expect(mocks.isUnifiedSignInEnabled).not.toHaveBeenCalled();
  });

  it("any failure reading the sessions renders the signed-out header", async () => {
    mocks.getCurrentSession.mockRejectedValue(new Error("database down"));
    const out = await html();
    expect(out).toContain('href="/account/sign-in"');
    expect(out).toContain("Sign in");
  });

  it("a staff session shows Staff workspace", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u1", globalRole: null } });
    expect(await html()).toContain("Staff workspace");
  });
});

describe("account header actions (#1009)", () => {
  const render = (input: Parameters<typeof otherWorkspaceContextsForAttendee>[0], signOut: AccountSignOutMode) =>
    renderToStaticMarkup(createElement(AccountHeaderActions, { contexts: otherWorkspaceContextsForAttendee(input), signOut }));

  it("attendee with no staff session: Sign out only", () => {
    const html = render({ hasStaffSession: false, isSystemAdmin: true }, "attendee");
    expect(html).toContain("Sign out");
    expect(html).not.toContain("Staff workspace");
    expect(html).not.toContain("System management");
  });

  it("staff session: Staff workspace next to Sign out, no System management", () => {
    const html = render({ hasStaffSession: true, isSystemAdmin: false }, "both");
    expect(html).toContain('href="/overview"');
    expect(html).toContain("Sign out");
    expect(html).not.toContain("System management");
  });

  it("system administrator: Staff workspace, System management and Sign out", () => {
    const html = render({ hasStaffSession: true, isSystemAdmin: true }, "both");
    expect(html).toContain('href="/overview"');
    expect(html).toContain('href="/admin"');
    expect(html).toContain("System management");
    expect(html).toContain("Sign out");
  });

  it("wires the mode to the button: a staff session's Sign out ends both sessions", () => {
    expect(render({ hasStaffSession: true, isSystemAdmin: false }, "both")).toContain('data-sign-out="both"');
    expect(render({ hasStaffSession: false, isSystemAdmin: false }, "attendee")).toContain('data-sign-out="attendee"');
  });

  it("shows no Sign out when the mode is none, but keeps the staff links", () => {
    const html = render({ hasStaffSession: true, isSystemAdmin: false }, "none");
    expect(html).toContain('href="/overview"');
    expect(html).not.toContain("Sign out");
  });
});

describe("what My account Sign out ends (#1009)", () => {
  it("attendee session only: ends the attendee session", () => {
    expect(accountSignOutMode({ hasAttendeeAccount: true, hasStaffSession: false, actingAsClubRole: false })).toBe("attendee");
  });

  it("attendee account reached through a staff session (via staff): ends both", () => {
    expect(accountSignOutMode({ hasAttendeeAccount: true, hasStaffSession: true, actingAsClubRole: false })).toBe("both");
  });

  it("both sessions on the browser: ends both", () => {
    expect(accountSignOutMode({ hasAttendeeAccount: true, hasStaffSession: true, actingAsClubRole: false })).toBe("both");
  });

  it("staff act-as with no attendee account: no Sign out", () => {
    expect(accountSignOutMode({ hasAttendeeAccount: false, hasStaffSession: true, actingAsClubRole: true })).toBe("none");
  });

  it("staff act-as whose email matches an attendee account: still no Sign out", () => {
    expect(accountSignOutMode({ hasAttendeeAccount: true, hasStaffSession: true, actingAsClubRole: true })).toBe("none");
  });

  it("nobody signed in: no Sign out", () => {
    expect(accountSignOutMode({ hasAttendeeAccount: false, hasStaffSession: false, actingAsClubRole: false })).toBe("none");
  });
});

describe("combined sign-out requests (#1009)", () => {
  it("attendee only: calls only the attendee endpoint", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await postAccountSignOut(false, send);
    expect(send.mock.calls.map((call) => call[0])).toEqual(["/api/attendee/sign-out"]);
  });

  it("with a staff session: calls the attendee endpoint and the staff logout, both as POST", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await postAccountSignOut(true, send);
    expect(send.mock.calls).toEqual([
      ["/api/attendee/sign-out", { method: "POST" }],
      ["/api/auth/logout", { method: "POST" }],
    ]);
  });

  it("a failing attendee request does not skip the staff logout", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(undefined);
    await postAccountSignOut(true, send);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
