import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1092: the /sign-in page's timed-out staff notice. Synthetic data only. */
const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  enabled: vi.fn(),
  getCurrentSession: vi.fn(),
  getCurrentAttendee: vi.fn(),
  timedOut: vi.fn(),
}));

class Redirected extends Error {}
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { mocks.redirect(to); throw new Redirected(to); },
}));
vi.mock("@/components/brand-link", () => ({ BrandLink: () => null }));
vi.mock("@/components/back-to-events-link", () => ({ BackToEventsLink: () => null }));
vi.mock("@/components/login-form", () => ({ LoginForm: () => null }));
vi.mock("@/components/attendee-google-button", () => ({
  AttendeeGoogleButton: () => null,
  attendeeSignInErrorMessage: () => null,
}));
vi.mock("@/components/combined-passkey-sign-in-button", () => ({ CombinedPasskeySignInButton: () => null }));
vi.mock("@/integrations/oauth/google", () => ({ isGoogleSignInConfigured: () => false }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/passkeys", () => ({ passkeysConfigured: async () => false }));
vi.mock("@/modules/access/post-login-destination", () => ({ resolvePostLoginDestination: async () => "/admin" }));
vi.mock("@/modules/account-merge/account-link", () => ({ isUnifiedSignInEnabled: mocks.enabled }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/attendee-accounts/passkeys", () => ({ passkeysConfigured: async () => false }));
vi.mock("@/modules/account-merge/staff-timeout", () => ({
  isStaffSessionTimedOutForLinkedAttendee: mocks.timedOut,
  STAFF_TIMED_OUT_NOTICE: "Your staff sign-in has ended, usually after an hour of inactivity. Sign in again to use staff tools. Your registrations are still signed in.",
}));

import SignInPage from "@/app/sign-in/page";
import { STAFF_SIGN_IN_HREF } from "@/components/public-header-links";

const NOTICE = "Your staff sign-in has ended";

async function visit(next?: string, staff?: string) {
  try {
    const element = await SignInPage({ searchParams: Promise.resolve({ ...(next ? { next } : {}), ...(staff ? { staff } : {}) }) });
    return renderToStaticMarkup(createElement(() => element));
  } catch (error) {
    if (error instanceof Redirected) return null;
    throw error;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockResolvedValue(true);
  mocks.getCurrentSession.mockResolvedValue({ user: null });
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "acct-1" }, via: "attendee", sessionId: "s1" });
  mocks.timedOut.mockResolvedValue(true);
});

describe("/sign-in with a linked attendee whose staff side ended", () => {
  it("(a) a staff target with the check true shows the notice and does not redirect", async () => {
    const html = await visit("/overview");
    expect(html).toContain(NOTICE);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("(b) an unlinked attendee session with a staff target still gets the form, with no notice (#1637)", async () => {
    mocks.timedOut.mockResolvedValue(false);
    const html = await visit("/overview");
    expect(html).not.toBeNull();
    expect(html).not.toContain(NOTICE);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("(c) no next redirects to /account and never runs the check", async () => {
    expect(await visit()).toBeNull();
    expect(mocks.redirect).toHaveBeenCalledWith("/account");
    expect(mocks.timedOut).not.toHaveBeenCalled();
  });

  it("(d) an attendee destination redirects there with no notice", async () => {
    expect(await visit("/account/registrations")).toBeNull();
    expect(mocks.redirect).toHaveBeenCalledWith("/account/registrations");
    expect(mocks.timedOut).not.toHaveBeenCalled();
  });

  it("staff intent without a next shows the form for linked and unlinked attendees, and never redirects to /account (#1637)", async () => {
    expect(await visit(undefined, "1")).toContain(NOTICE);
    mocks.timedOut.mockResolvedValue(false);
    const html = await visit(undefined, "1");
    expect(html).not.toBeNull();
    expect(html).not.toContain(NOTICE);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("the header Staff sign-in link shows the form: notice when linked, none when unlinked", async () => {
    const params = new URLSearchParams(STAFF_SIGN_IN_HREF.split("?")[1]);
    const next = params.get("next") ?? undefined;
    expect(await visit(next, params.get("staff") ?? undefined)).toContain(NOTICE);
    mocks.timedOut.mockResolvedValue(false);
    const html = await visit(next, params.get("staff") ?? undefined);
    expect(html).not.toBeNull();
    expect(html).not.toContain(NOTICE);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("an old /select-event next counts as staff intent", async () => {
    mocks.timedOut.mockResolvedValue(false);
    expect(await visit("/select-event")).not.toBeNull();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each(["/overview", "/people/x?y=1", "/admin", "/event-setup", "/archived-events"])("a staff page next (%s) shows the form", async (next) => {
    expect(await visit(next)).not.toBeNull();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("only staff=1 counts as intent", async () => {
    expect(await visit(undefined, "yes")).toBeNull();
    expect(mocks.redirect).toHaveBeenCalledWith("/account");
  });

  it.each(["//evil.com", "https://evil.example/x", "/api/auth/login", "/\\evil.com", "/login", "/sign-in", "/no-access", "/", "/events/spring-camporee", "/register/abc"])(
    "an unsafe or non-staff next (%s) keeps the redirect to /account",
    async (next) => {
      expect(await visit(next)).toBeNull();
      expect(mocks.redirect).toHaveBeenCalledWith("/account");
      expect(mocks.timedOut).not.toHaveBeenCalled();
    },
  );

  it("an unsafe next does not stop the staff intent form, and is not passed into it", async () => {
    const html = await visit("//evil.com", "1");
    expect(html).not.toBeNull();
    expect(html).not.toContain("evil.com");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("a live staff session still goes through role routing", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u1" } });
    expect(await visit(undefined, "1")).toBeNull();
    expect(mocks.redirect).toHaveBeenCalledWith("/admin");
  });

  it("with the switch off it goes to /login whatever else is asked", async () => {
    mocks.enabled.mockResolvedValue(false);
    expect(await visit("/overview", "1")).toBeNull();
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });

  it("an anonymous visitor sees no notice", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    mocks.timedOut.mockResolvedValue(false);
    const html = await visit("/overview");
    expect(html).not.toContain(NOTICE);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
