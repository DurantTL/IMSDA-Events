import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

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
import { otherWorkspaceContextsForAttendee } from "@/modules/access/workspace-contexts";

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

  it("a staff session shows Staff workspace", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u1", globalRole: null } });
    expect(await html()).toContain("Staff workspace");
  });
});

describe("account header actions (#1009)", () => {
  const render = (input: Parameters<typeof otherWorkspaceContextsForAttendee>[0], showSignOut = true) =>
    renderToStaticMarkup(createElement(AccountHeaderActions, { contexts: otherWorkspaceContextsForAttendee(input), showSignOut }));

  it("attendee with no staff session: Sign out only", () => {
    const html = render({ hasStaffSession: false, isSystemAdmin: true });
    expect(html).toContain("Sign out");
    expect(html).not.toContain("Staff workspace");
    expect(html).not.toContain("System management");
  });

  it("staff session: Staff workspace next to Sign out, no System management", () => {
    const html = render({ hasStaffSession: true, isSystemAdmin: false });
    expect(html).toContain('href="/overview"');
    expect(html).toContain("Sign out");
    expect(html).not.toContain("System management");
  });

  it("system administrator: Staff workspace, System management and Sign out", () => {
    const html = render({ hasStaffSession: true, isSystemAdmin: true });
    expect(html).toContain('href="/overview"');
    expect(html).toContain('href="/admin"');
    expect(html).toContain("System management");
    expect(html).toContain("Sign out");
  });
});
