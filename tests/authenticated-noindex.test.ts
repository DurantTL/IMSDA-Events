import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Only each page's exported `metadata` is under test, and it is a plain
// constant. A page's data and session modules pull in most of the data layer,
// and importing that graph cold cost about 5 s on a quiet machine and much more
// under load. Stub those modules (nothing runs until a page renders) so the real
// page and layout modules still load and their real `metadata` is asserted.
vi.mock("@/components/workspace-shell", () => ({}));
vi.mock("@/components/club-access-gate", () => ({}));
vi.mock("@/components/club-gate-slot", () => ({}));
vi.mock("@/components/club-banner-year", () => ({}));
vi.mock("@/components/club-portal-masthead", () => ({}));
vi.mock("@/components/club-portal-nav", () => ({}));
vi.mock("@/components/event-settings-workspace", () => ({}));
vi.mock("@/modules/access/auth-service", () => ({}));
vi.mock("@/modules/access/current-session", () => ({}));
vi.mock("@/modules/access/passkeys", () => ({}));
vi.mock("@/modules/access/post-login-destination", () => ({}));
vi.mock("@/modules/account-merge/sign-in-redirect", () => ({}));
vi.mock("@/modules/account-profile/load-profile", () => ({}));
vi.mock("@/modules/attendee-accounts/portal-second-step", () => ({}));
vi.mock("@/modules/calendar/event-links", () => ({}));
vi.mock("@/modules/club-rosters/access", () => ({}));
vi.mock("@/modules/communications/account-email", () => ({}));

// Authenticated and token pages stay out of search indexes (#108). Child pages
// inherit a layout's `robots` unless they set their own.
describe("authenticated pages are noindex (#108)", () => {
  it.each([
    ["the staff workspace layout", () => import("@/app/(workspace)/layout")],
    ["the club portal layout", () => import("@/app/(public)/account/(portal)/clubs/[organizationId]/layout")],
    ["staff sign-in", () => import("@/app/login/page")],
    ["no access", () => import("@/app/no-access/page")],
    ["event setup", () => import("@/app/(workspace)/event-setup/page")],
    ["forgot password", () => import("@/app/forgot-password/page")],
    ["reset password", () => import("@/app/reset-password/page")],
  ])("%s sets robots index: false", async (_name, load) => {
    const { metadata } = await load();
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});
