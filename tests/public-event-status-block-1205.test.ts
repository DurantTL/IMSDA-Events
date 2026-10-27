import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describePublicEventLifecycle } from "@/modules/events/public-domain";

const mocks = vi.hoisted(() => ({ getPublicEventLanding: vi.fn(), getAutoEventInfoCards: vi.fn() }));

vi.mock("@/modules/events/public-repository", () => ({ getPublicEventLanding: mocks.getPublicEventLanding }));
vi.mock("@/modules/event-info-cards/repository", () => ({ getAutoEventInfoCards: mocks.getAutoEventInfoCards }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/components/public-header-session-links", () => ({ PublicHeaderSessionLinks: () => null }));

import PublicEventPage from "@/app/(public)/events/[eventSlug]/page";

/**
 * Every registration state shows exactly one status message and at most one primary action (#1205). Synthetic data.
 */

const base = {
  isPublished: true, archivedAt: null, timezone: "America/Chicago", capacity: 10,
  registrationOpensOn: "2026-12-01", registrationClosesOn: "2027-01-15", waitlistEnabled: true, endsAt: new Date("2027-02-07T18:00:00Z"),
};
const form = (n: number) => ({
  id: `form-${n}`, slug: `form-${n}`, title: `Synthetic form ${n}`, audienceLabel: "Event registration", differentiator: null,
  description: "Fictitious description.", highlights: ["One registration at a time"], registrationPath: "PUBLIC_FORM", href: `/register/synthetic/form-${n}`,
});

function landing(event: Record<string, unknown>, occupied: number, now: string, forms: unknown[]) {
  return {
    event: {
      slug: "synthetic-event", name: "Synthetic Winter Retreat", startsAt: "2027-02-05T15:00:00.000Z", endsAt: "2027-02-07T18:00:00.000Z",
      timezone: "America/Chicago", location: "Synthetic Camp", capacity: 10, supportContact: "events@example.test", audience: "GENERAL",
      dateLabel: "February 5 – 7, 2027", timeLabel: "Fri 9:00 AM – Sun 12:00 PM CST",
    },
    lifecycle: describePublicEventLifecycle({ ...base, ...event }, occupied, new Date(now), forms.length > 0),
    forms, generalLink: null, groupRegistration: null, contentSections: [], announcements: [],
    links: { detailsUrl: null, supportUrl: "https://imsda.org/contact/" },
  };
}

const render = async () => renderToStaticMarkup(await PublicEventPage({ params: Promise.resolve({ eventSlug: "synthetic-event" }) }));
const count = (markup: string, text: string) => markup.split(text).length - 1;
const primaryActions = (markup: string) => count(markup, "public-event-status-action") + count(markup, "public-event-form-cta");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAutoEventInfoCards.mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());

const cases: Array<{ name: string; data: () => ReturnType<typeof landing>; message: string; action: string | null; absent: string[] }> = [
  { name: "no forms yet (open dates)", data: () => landing({ registrationOpensOn: "2026-10-01" }, 0, "2026-11-01T18:00:00Z", []), message: "Registration opening soon", action: "Add to my calendar", absent: ["Registration open<", "being prepared", "Current availability"] },
  { name: "before opening", data: () => landing({}, 0, "2026-10-27T18:00:00Z", [form(1)]), message: "Registration opens in December", action: "Add to my calendar", absent: ["being prepared", "Current availability", "Choose how", "Synthetic form 1"] },
  { name: "open, one form", data: () => landing({}, 3, "2026-12-05T18:00:00Z", [form(1)]), message: "Registration open", action: "Register", absent: ["being prepared", "Current availability"] },
  { name: "open, several forms", data: () => landing({}, 3, "2026-12-05T18:00:00Z", [form(1), form(2)]), message: "Registration open", action: "Register", absent: ["Current availability"] },
  { name: "waitlist", data: () => landing({}, 10, "2026-12-05T18:00:00Z", [form(1)]), message: "Event full · waitlist open", action: "Join the waitlist", absent: ["Current availability"] },
  { name: "full", data: () => landing({ waitlistEnabled: false }, 10, "2026-12-05T18:00:00Z", [form(1)]), message: "Event full", action: null, absent: ["Join the waitlist", "Register<"] },
  { name: "closed", data: () => landing({}, 3, "2027-01-20T18:00:00Z", [form(1)]), message: "Registration closed", action: null, absent: ["Register<", "Join the waitlist"] },
  { name: "ended", data: () => landing({}, 3, "2027-02-20T18:00:00Z", [form(1)]), message: "This event has ended", action: null, absent: ["Register<", "Join the waitlist"] },
];

describe("the event page's one status block (#1205)", () => {
  for (const item of cases) {
    it(`${item.name}: one status message, at most one primary action`, async () => {
      mocks.getPublicEventLanding.mockResolvedValue(item.data());
      const markup = await render();
      expect(count(markup, 'id="event-status-title"')).toBe(1);
      expect(markup).toContain(`>${item.message}</h2>`);
      // The message is stated once: the heading, never a second card or placeholder.
      expect(count(markup, item.message)).toBe(1);
      for (const text of item.absent) expect(markup).not.toContain(text);
      if (item.action) {
        expect(markup).toContain(item.action);
        expect(primaryActions(markup)).toBeLessThanOrEqual(item.name === "open, several forms" ? 3 : 1);
      } else {
        expect(primaryActions(markup)).toBe(0);
      }
      expect(markup).toContain("When:");
      expect(markup).toContain("Where:");
      expect(markup).not.toContain("registration is not open");
    });
  }

  it("before opening, Add to my calendar goes to the event's own .ics", async () => {
    mocks.getPublicEventLanding.mockResolvedValue(cases[1].data());
    expect(await render()).toContain('href="/events/synthetic-event/event.ics"');
  });

  it("one form: the status button goes straight to the form and the card has no second button", async () => {
    mocks.getPublicEventLanding.mockResolvedValue(cases[2].data());
    const markup = await render();
    expect(markup).toContain('href="/register/synthetic/form-1"');
    expect(count(markup, 'href="/register/synthetic/form-1"')).toBe(1);
  });

  it("several forms: the status button jumps to the list and each form has its own link", async () => {
    mocks.getPublicEventLanding.mockResolvedValue(cases[3].data());
    const markup = await render();
    expect(markup).toContain('href="#registration-options"');
    expect(markup).toContain('id="registration-options"');
    expect(markup).toContain('href="/register/synthetic/form-1"');
    expect(markup).toContain('href="/register/synthetic/form-2"');
  });

  it("help and contact come last, as a quiet section", async () => {
    mocks.getPublicEventLanding.mockResolvedValue(cases[2].data());
    const markup = await render();
    expect(markup).toContain('class="public-event-help-section"');
    expect(markup.indexOf("public-event-help-section")).toBeGreaterThan(markup.indexOf("public-event-status-block"));
    expect(markup.indexOf("events@example.test")).toBeGreaterThan(markup.indexOf("public-event-layout"));
  });

  it("an open club event with a club-portal form has one status message and one primary action", async () => {
    const data = landing({ audience: "CLUB" }, 3, "2026-12-05T18:00:00Z", [{ ...form(1), registrationPath: "CLUB_PORTAL", href: "/account/club-registration/synthetic-event" }]);
    data.event.audience = "CLUB";
    mocks.getPublicEventLanding.mockResolvedValue(data);
    const markup = await render();
    expect(markup).toContain("club-director-sign-in-notice");
    expect(count(markup, 'id="event-status-title"')).toBe(1);
    expect(count(markup, "primary-button")).toBe(1);
    expect(markup).toMatch(/class="secondary-button club-director-notice-button"/);
    expect(markup).toContain("Sign in to register your club");
    expect(markup).not.toMatch(/<h2[^>]*id="club-director-sign-in-title"/);
  });
});
