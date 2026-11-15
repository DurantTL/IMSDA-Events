import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  archived: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); }),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("@/modules/events/public-repository", () => ({ isArchivedPublicEventSlug: mocks.archived }));
vi.mock("@/modules/information-forms/public", () => ({
  publicInformationFormKey: () => "key",
  publicInformationFormPath: () => "/x",
  resolvePublicInformationForm: mocks.resolve,
}));
vi.mock("@/modules/rate-limit/service", () => ({
  checkInformationFormClientRateLimit: async () => ({ allowed: true }),
  checkInformationFormRateLimit: async () => ({ allowed: true }),
}));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: vi.fn() }));
vi.mock("@/modules/attendee-accounts/portal-second-step", () => ({ attendeeSignInStepPending: vi.fn() }));
vi.mock("@/modules/security/security-check-config", () => ({ securityCheckConfigForPage: vi.fn() }));
vi.mock("@/components/brand-link", () => ({ BrandLink: () => null }));
vi.mock("@/components/information-form-fill-in", () => ({ InformationFormFillIn: () => null }));

import { InformationFormPublicPage } from "@/components/information-form-public-page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({ state: "NOT_FOUND" });
});

describe("information form of an archived event (#1514)", () => {
  it("redirects to the events list notice when the event is archived and published", async () => {
    mocks.archived.mockResolvedValue(true);
    await expect(InformationFormPublicPage({ target: { slug: "f", eventSlug: "old" } })).rejects.toThrow("NEXT_REDIRECT:/events?ended=1");
    expect(mocks.archived).toHaveBeenCalledWith("old");
  });
  it("is not found otherwise", async () => {
    mocks.archived.mockResolvedValue(false);
    await expect(InformationFormPublicPage({ target: { slug: "f", eventSlug: "draft" } })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("never asks about archiving for a form with no event in its address", async () => {
    await expect(InformationFormPublicPage({ target: { slug: "f" } })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.archived).not.toHaveBeenCalled();
  });
});
