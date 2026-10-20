import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  staffPasskeys: vi.fn(),
  attendeePasskeys: vi.fn(),
  getCurrentSession: vi.fn(),
  getCurrentAttendee: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/login-form", () => ({ LoginForm: () => null }));
vi.mock("@/components/attendee-google-button", () => ({
  AttendeeGoogleButton: () => null,
  attendeeSignInErrorMessage: () => null,
}));
vi.mock("@/integrations/oauth/google", () => ({ isGoogleSignInConfigured: () => false }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/passkeys", () => ({ passkeysConfigured: mocks.staffPasskeys }));
vi.mock("@/modules/access/post-login-destination", () => ({ resolvePostLoginDestination: vi.fn() }));
vi.mock("@/modules/account-merge/account-link", () => ({ isUnifiedSignInEnabled: mocks.enabled }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/attendee-accounts/passkeys", () => ({ passkeysConfigured: mocks.attendeePasskeys }));

import SignInPage from "@/app/sign-in/page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockResolvedValue(true);
  mocks.staffPasskeys.mockResolvedValue(true);
  mocks.attendeePasskeys.mockResolvedValue(true);
  mocks.getCurrentSession.mockResolvedValue({ user: null });
  mocks.getCurrentAttendee.mockResolvedValue({ account: null });
});

describe("/sign-in passkey button (#1085)", () => {
  it("renders exactly one passkey button, with neutral wording", async () => {
    const markup = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({}) }));
    expect(markup.match(/passkey-sign-in-button/g)).toHaveLength(1);
    expect(markup).toContain("Sign in with a passkey");
    expect(markup).not.toContain("team passkey");
    expect(markup).not.toContain("account passkey");
  });

  it("renders no passkey button when passkeys are not set up", async () => {
    mocks.staffPasskeys.mockResolvedValue(false);
    mocks.attendeePasskeys.mockResolvedValue(false);
    const markup = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({}) }));
    expect(markup).not.toContain("passkey-sign-in-button");
  });
});
