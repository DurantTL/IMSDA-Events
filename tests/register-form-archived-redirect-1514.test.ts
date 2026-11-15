import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  experience: vi.fn(),
  archived: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); }),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("@/modules/events/public-repository", () => ({ isArchivedPublicEventSlug: mocks.archived }));
vi.mock("@/modules/forms/public-repository", () => ({ getPublicRegistrationExperience: mocks.experience }));
vi.mock("@/modules/general-link-registrations/repository", () => ({ clubEventEntryRedirect: vi.fn() }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: vi.fn() }));
vi.mock("@/modules/attendee-accounts/profile-service", () => ({ attendeeProfilePrefill: vi.fn(), getAttendeeProfile: vi.fn(), withoutPersonalDetails: vi.fn() }));
vi.mock("@/modules/attendee-accounts/portal-second-step", () => ({ attendeeSignInStepPending: vi.fn() }));
vi.mock("@/modules/attendee-accounts/passkey-offer-eligibility", () => ({ passkeyOfferForPage: vi.fn() }));
vi.mock("@/modules/system-admin/platform-settings", () => ({ getFormsHelpContact: vi.fn() }));
vi.mock("@/modules/events/content-repository", () => ({ listPublishedRegistrationInfoCards: vi.fn() }));
vi.mock("@/modules/event-info-cards/repository", () => ({ getAutoEventInfoCards: vi.fn() }));
vi.mock("@/modules/registration-themes/repository", () => ({ getPublishedThemeRowBySlug: vi.fn() }));
vi.mock("@/modules/security/security-check-config", () => ({ securityCheckConfigForPage: vi.fn() }));
vi.mock("@/components/public-metrics-beacon", () => ({ PublicMetricsBeacon: () => null }));
vi.mock("@/components/auto-event-info-cards", () => ({ AutoEventInfoCards: () => null }));
vi.mock("@/components/club-director-sign-in-notice", () => ({ ClubDirectorSignInNotice: () => null }));
vi.mock("@/components/event-info-cards", () => ({ EventInfoCards: () => null }));
vi.mock("@/components/event-content-blocks", () => ({ EventContentBlocks: () => null, publicEventAssetUrl: vi.fn() }));
vi.mock("@/components/public-registration-form", () => ({ PublicRegistrationForm: () => null }));
vi.mock("@/components/registration-theme-scope", () => ({ RegistrationThemeScope: () => null }));

import PublicRegistrationPage from "@/app/(public)/register/[eventSlug]/[formSlug]/page";

const props = (eventSlug: string) => ({ params: Promise.resolve({ eventSlug, formSlug: "main" }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.experience.mockResolvedValue(null);
});

describe("/register/[eventSlug]/[formSlug] of an archived event (#1514)", () => {
  it("redirects to the events list notice for an archived published event", async () => {
    mocks.archived.mockResolvedValue(true);
    await expect(PublicRegistrationPage(props("old"))).rejects.toThrow("NEXT_REDIRECT:/events?ended=1");
  });
  it("is not found for an unknown or unpublished event", async () => {
    mocks.archived.mockResolvedValue(false);
    await expect(PublicRegistrationPage(props("draft"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
