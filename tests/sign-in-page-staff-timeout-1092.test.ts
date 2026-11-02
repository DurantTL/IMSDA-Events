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

const NOTICE = "Your staff sign-in has ended";

async function visit(next?: string) {
  try {
    const element = await SignInPage({ searchParams: Promise.resolve(next ? { next } : {}) });
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

  it("(b) the same with the check false redirects as before", async () => {
    mocks.timedOut.mockResolvedValue(false);
    expect(await visit("/overview")).toBeNull();
    expect(mocks.redirect).toHaveBeenCalledWith("/account");
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

  it("an anonymous visitor sees no notice", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    mocks.timedOut.mockResolvedValue(false);
    const html = await visit("/overview");
    expect(html).not.toContain(NOTICE);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
