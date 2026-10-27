import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPublicEventLanding: vi.fn(),
  getAutoEventInfoCards: vi.fn(),
}));

vi.mock("@/modules/events/public-repository", () => ({ getPublicEventLanding: mocks.getPublicEventLanding }));
vi.mock("@/modules/event-info-cards/repository", () => ({ getAutoEventInfoCards: mocks.getAutoEventInfoCards }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("server-only", () => ({}));
// The header's session links read cookies and the database (#1009); they have their own tests.
vi.mock("@/components/public-header-session-links", () => ({ PublicHeaderSessionLinks: () => null }));

import PublicEventPage from "@/app/(public)/events/[eventSlug]/page";

/**
 * One hero on the public event page (#1004): with a banner that draws, the event header is a plain details row; the page
 * always has exactly one h1; and the event's name appears even when the banner's free-text title differs. Synthetic data.
 */

const EVENT_NAME = "Synthetic Fall Retreat";

const landing = (contentSections: unknown[]) => ({
  event: {
    slug: "synthetic-event", name: EVENT_NAME, startsAt: "2026-11-06T15:00:00.000Z", endsAt: "2026-11-08T18:00:00.000Z",
    timezone: "America/Chicago", location: "Synthetic Camp", capacity: null, supportContact: "events@example.test",
    audience: "GENERAL", dateLabel: "November 6 – 8, 2026", timeLabel: "Friday, 9:00 AM CST – Sunday, 12:00 PM CST",
  },
  lifecycle: {
    phase: "OPEN", state: "OPEN", statusLabel: "Registration open", detail: "Choose a form.", ctaLabel: "Register", action: "REGISTER",
    ctaEnabled: true, ended: false, formsHeading: "Choose how you are registering", remainingSpots: null,
  },
  forms: [],
  contentSections,
  links: { detailsUrl: null, supportUrl: "https://imsda.org/contact/" },
  announcements: [],
});

const banner = (title: string, data: Record<string, unknown>) => ({
  id: "hero-1", kind: "HERO", title, body: "", placement: "PUBLIC_PAGE", data,
});
const validHero = { assetId: "asset-1", alt: "Pines at sunrise", subtitle: "Join us", button: null, focalX: 50, focalY: 50, overlay: 40 };

const render = async () => renderToStaticMarkup(await PublicEventPage({ params: Promise.resolve({ eventSlug: "synthetic-event" }) }));
const count = (markup: string, text: string) => markup.split(text).length - 1;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("public event page with a header banner (#1004)", () => {
  it("shows the event name once, as text, when the banner's title differs, with exactly one h1", async () => {
    mocks.getPublicEventLanding.mockResolvedValue(landing([banner("Come away with us", validHero)]));
    const markup = await render();
    expect(count(markup, "<h1")).toBe(1);
    expect(markup).toContain("Come away with us");
    expect(count(markup, EVENT_NAME)).toBe(1);
    expect(markup).toContain(`<p class="public-event-facts-name">${EVENT_NAME}</p>`);
    expect(markup).not.toContain("public-registration-hero");
  });

  it("does not repeat the name when the banner's title already is the event name", async () => {
    mocks.getPublicEventLanding.mockResolvedValue(landing([banner(EVENT_NAME, validHero)]));
    const markup = await render();
    expect(count(markup, "<h1")).toBe(1);
    expect(count(markup, EVENT_NAME)).toBe(1);
    expect(markup).not.toContain("public-event-facts-name");
  });

  it("falls back to the page's own h1 with the event name when the banner data is invalid", async () => {
    mocks.getPublicEventLanding.mockResolvedValue(landing([banner("Come away with us", { alt: "no asset id" })]));
    const markup = await render();
    expect(count(markup, "<h1")).toBe(1);
    expect(markup).toContain(`<h1>${EVENT_NAME}</h1>`);
    expect(markup).not.toContain("Come away with us");
    expect(markup).not.toContain("public-event-facts");
  });

  it("keeps the usual hero and h1 when there is no banner", async () => {
    mocks.getPublicEventLanding.mockResolvedValue(landing([]));
    const markup = await render();
    expect(count(markup, "<h1")).toBe(1);
    expect(markup).toContain(`<h1>${EVENT_NAME}</h1>`);
    expect(markup).toContain("public-registration-hero");
  });
});
