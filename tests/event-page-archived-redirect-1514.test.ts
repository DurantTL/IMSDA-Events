import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPublicEventLanding: vi.fn(),
  isArchivedPublicEventSlug: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/events/public-repository", () => ({
  getPublicEventLanding: mocks.getPublicEventLanding,
  isArchivedPublicEventSlug: mocks.isArchivedPublicEventSlug,
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("@/modules/event-info-cards/repository", () => ({ getAutoEventInfoCards: vi.fn() }));
vi.mock("@/components/public-event-landing-view", () => ({ PublicEventLandingView: () => null }));
vi.mock("@/modules/site-content/hub-content", () => ({ getPublishedHubContent: async () => ({}) }));
vi.mock("@/components/public-event-slug-not-found", () => ({ PublicEventSlugNotFound: () => null }));

import PublicEventPage from "@/app/(public)/events/[eventSlug]/page";
import RegisterEventPage from "@/app/(public)/register/[eventSlug]/page";

const params = (eventSlug: string) => ({ params: Promise.resolve({ eventSlug }) });
const landing = { event: { slug: "live-retreat", name: "Live", audience: "PUBLIC" } };

beforeEach(() => vi.clearAllMocks());

describe("archived published event pages (#1514)", () => {
  it("redirects the event page of an archived published event to the events list notice", async () => {
    mocks.getPublicEventLanding.mockResolvedValue(null);
    mocks.isArchivedPublicEventSlug.mockResolvedValue(true);
    await expect(PublicEventPage(params("old-retreat"))).rejects.toThrow("NEXT_REDIRECT:/events?ended=1");
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("keeps a missing or unpublished event page a not-found", async () => {
    mocks.getPublicEventLanding.mockResolvedValue(null);
    mocks.isArchivedPublicEventSlug.mockResolvedValue(false);
    await expect(PublicEventPage(params("draft-retreat"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("renders a live event without asking about archiving", async () => {
    mocks.getPublicEventLanding.mockResolvedValue(landing);
    const element = await PublicEventPage(params("live-retreat"));
    expect(element).toBeTruthy();
    expect(mocks.isArchivedPublicEventSlug).not.toHaveBeenCalled();
  });

  it("sends /register/<slug> of an archived event to the notice, and a live one to its page", async () => {
    mocks.getPublicEventLanding.mockResolvedValue(null);
    mocks.isArchivedPublicEventSlug.mockResolvedValue(true);
    await expect(RegisterEventPage(params("old-retreat"))).rejects.toThrow("NEXT_REDIRECT:/events?ended=1");
    mocks.getPublicEventLanding.mockResolvedValue(landing);
    await expect(RegisterEventPage(params("live-retreat"))).rejects.toThrow("NEXT_REDIRECT:/events/live-retreat");
  });

  it("keeps an unknown or unpublished /register slug on the branded not-found page", async () => {
    mocks.getPublicEventLanding.mockResolvedValue(null);
    mocks.isArchivedPublicEventSlug.mockResolvedValue(false);
    const element = await RegisterEventPage(params("never-published"));
    expect(renderToStaticMarkup(element as React.ReactElement)).toBe("");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("isArchivedPublicEventSlug", () => {
  it("asks only for a published, archived event that is not a billing container, selecting just the id", async () => {
    vi.resetModules();
    vi.doUnmock("@/modules/events/public-repository");
    const findFirst = vi.fn().mockResolvedValue({ id: "e1" });
    vi.doMock("@/lib/prisma", () => ({ getPrisma: () => ({ event: { findFirst } }) }));
    const { isArchivedPublicEventSlug } = await import("@/modules/events/public-repository");
    expect(await isArchivedPublicEventSlug("old-retreat")).toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: { slug: "old-retreat", isPublished: true, archivedAt: { not: null }, isBillingContainer: false },
      select: { id: true },
    });
    findFirst.mockResolvedValue(null);
    expect(await isArchivedPublicEventSlug("draft")).toBe(false);
  });
});
