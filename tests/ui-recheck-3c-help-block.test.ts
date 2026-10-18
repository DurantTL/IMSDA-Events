import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPublicEventLanding: vi.fn(), getAutoEventInfoCards: vi.fn() }));

vi.mock("@/modules/events/public-repository", () => ({ getPublicEventLanding: mocks.getPublicEventLanding }));
vi.mock("@/modules/event-info-cards/repository", () => ({ getAutoEventInfoCards: mocks.getAutoEventInfoCards }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("server-only", () => ({}));

import PublicEventPage from "@/app/(public)/events/[eventSlug]/page";

// Synthetic data only. One help block per club event page, without losing a support contact (#1005).
const landing = (supportContact: string | null) => ({
  event: {
    slug: "synthetic-club-event", name: "Synthetic Club Event", audience: "CLUB",
    startsAt: "2027-01-17T15:00:00.000Z", endsAt: "2027-01-17T22:00:00.000Z", timezone: "America/Chicago",
    location: "Fictitious Hall", capacity: 100, supportContact, dateLabel: "January 17, 2027", timeLabel: "9:00 AM",
  },
  lifecycle: {
    phase: "OPEN", state: "OPEN", statusLabel: "Registration open", detail: "Choose a form.", ctaLabel: "Start registration",
    ctaEnabled: true, ended: false, heroTagline: "Tagline.", formsHeading: "Choose how you’re registering",
    emptyForms: { title: "Forms are being prepared", body: "Soon." },
    availability: { heading: "Registration open", body: "Spots remain." }, remainingSpots: 10,
  },
  forms: [], contentSections: [], announcements: [],
  links: { detailsUrl: null, supportUrl: "https://imsda.org/contact/" },
});
const autoCards = { header: { eyebrow: "Conference event", title: "Synthetic Club Event", tagline: null, meta: "January 17, 2027", subtitle: null }, classes: null, dates: null, deadlines: null, fees: null, steps: null, help: { email: "help@example.test" } };

async function render(supportContact: string | null) {
  mocks.getPublicEventLanding.mockResolvedValue(landing(supportContact));
  mocks.getAutoEventInfoCards.mockResolvedValue(autoCards);
  return renderToStaticMarkup(await PublicEventPage({ params: Promise.resolve({ eventSlug: "synthetic-club-event" }) }));
}

const helpBlocks = (markup: string) => markup.split("Need help?").length - 1;

describe("a club event's help blocks (#1005)", () => {
  it("keeps the sidebar contact when the event has its own support contact", async () => {
    const markup = await render("events@example.test");
    expect(markup).toContain("events@example.test");
    expect(markup).toContain("https://imsda.org/contact/");
    expect(markup).toContain("help@example.test");
  });

  it("shows one help block when the sidebar would add nothing", async () => {
    const markup = await render(null);
    expect(helpBlocks(markup)).toBe(1);
    expect(markup).toContain("help@example.test");
    const same = await render("Help@Example.test");
    expect(helpBlocks(same)).toBe(1);
  });
});
