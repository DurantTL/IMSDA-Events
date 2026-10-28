/* eslint-disable @typescript-eslint/no-explicit-any -- the fake database receives loosely typed Prisma arguments */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #111: the public pages draw curated hub content and fall back to today's output when nothing is curated. The
 * homepage runs through the same component the staff preview uses. Synthetic data only.
 */

const mocks = vi.hoisted(() => ({
  listPublicCalendarItems: vi.fn(),
  getCurrentAttendee: vi.fn(),
  ministries: vi.fn(),
  help: vi.fn(),
  curated: vi.fn(),
  flagged: vi.fn(),
  images: vi.fn(),
  eventFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/calendar/repository", () => ({ conferenceToday: () => "2026-10-28", listPublicCalendarItems: mocks.listPublicCalendarItems }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/system-admin/homepage-ministries", () => ({ listHomepageMinistries: mocks.ministries }));
vi.mock("@/modules/system-admin/platform-settings", () => ({ getPublicHelpContact: mocks.help }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ event: { findMany: mocks.eventFindMany } }) }));
vi.mock("@/components/public-header-session-links", () => ({ PublicHeaderSessionLinks: () => null }));
// The homepage test below swaps the real featured query for a stub so only the content's own rules are under test.
vi.mock("@/modules/events/featured", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/events/featured")>();
  return { ...original, listCuratedFeaturedRows: mocks.curated, listFeaturedEventRows: mocks.flagged, listEventCardImages: mocks.images };
});

import { PublicHomePage } from "@/components/public-home-page";
import { PublicHeaderNavLinks } from "@/components/public-header-nav-links";
import { SiteNoticesView } from "@/components/site-notices-view";
const realFeatured = () => vi.importActual<typeof import("@/modules/events/featured")>("@/modules/events/featured");
import { fallbackHomepageMinistries } from "@/modules/system-admin/homepage-ministries-domain";
import { defaultHubContent, type HubContent } from "@/modules/site-content/hub-content-domain";

const render = async (content: HubContent) => renderToStaticMarkup(await PublicHomePage({ content }));
const withContent = (patch: Partial<HubContent>): HubContent => ({ ...defaultHubContent(), ...patch });
const position = (html: string, marker: string) => html.indexOf(marker);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listPublicCalendarItems.mockResolvedValue([]);
  mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
  mocks.ministries.mockResolvedValue(fallbackHomepageMinistries);
  mocks.help.mockResolvedValue({ phone: null, email: null });
  mocks.curated.mockResolvedValue([]);
  mocks.flagged.mockResolvedValue([]);
  mocks.images.mockResolvedValue(new Map());
});

describe("the homepage with nothing curated", () => {
  it("is today's page: the same sections and headings in the same order, the standard verse, no notices or announcements", async () => {
    const html = await render(defaultHubContent());
    const order = ["public-home-banner", "home-season-heading", "home-places-heading", "home-months-heading", 'aria-label="Get started"', "home-footer"].map((marker) => position(html, marker));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("<h2 id=\"home-season-heading\">Next six months</h2>");
    expect(html).toContain("<h2 id=\"home-places-heading\">Find your place</h2>");
    expect(html).toContain('<p class="home-footer-verse">Not forsaking the assembling of ourselves together. <cite>Hebrews 10:25</cite></p>');
    expect(html).not.toContain("site-notices");
    expect(html).not.toContain("home-announcements");
    expect(html).not.toContain("home-footer-links");
    expect(html).not.toContain("home-footer-contact");
  });

  it("asks for no chosen events, which keeps today's Event.featured behaviour", async () => {
    await render(defaultHubContent());
    expect(mocks.curated).toHaveBeenCalledWith([], "2026-10-28");
  });
});

describe("the homepage with curated content", () => {
  it("shows announcements that are showing, and hides the section when none are", async () => {
    const announcements = [
      { id: "a", title: "Fictitious registration help", body: "Call the office <b>today</b>.", linkHref: "/events", linkLabel: "See events" },
      { id: "b", title: "Fictitious past news", body: "Old.", endsOn: "2026-10-01" },
      { id: "c", title: "Fictitious coming news", body: "Soon.", startsOn: "2026-12-01" },
    ];
    const html = await render(withContent({ announcements }));
    expect(html).toContain('<h2 id="home-announcements-heading">Announcements</h2>');
    expect(html).toContain("Fictitious registration help");
    // Plain text only: markup in the text is escaped, never rendered.
    expect(html).toContain("Call the office &lt;b&gt;today&lt;/b&gt;.");
    expect(html).toContain('href="/events"');
    expect(html).not.toContain("Fictitious past news");
    expect(html).not.toContain("Fictitious coming news");
    expect(await render(withContent({ announcements: [announcements[1]] }))).not.toContain("home-announcements");
  });

  it("follows the order, visibility and headings staff set", async () => {
    const reordered: HubContent["sections"] = [
      { key: "find-your-place", visible: true, heading: "Where do you belong?" },
      { key: "season-ribbon", visible: true },
      { key: "featured", visible: false },
      { key: "closing-soon", visible: true },
      { key: "announcements", visible: true },
    ];
    const html = await render(withContent({ sections: reordered }));
    expect(html).toContain('<h2 id="home-places-heading">Where do you belong?</h2>');
    expect(position(html, "home-places-heading")).toBeLessThan(position(html, "home-season-heading"));
    expect(html).not.toContain("home-featured-heading");
    const hidden = await render(withContent({ sections: reordered.map((section) => (section.key === "season-ribbon" ? { ...section, visible: false } : section)) }));
    expect(hidden).not.toContain("home-season-heading");
    expect(hidden).not.toContain("home-months-heading");
  });

  it("shows the notices, serious ones first, in a labelled region with the level in words", async () => {
    const html = await render(withContent({
      notices: [
        { id: "a", level: "INFO", message: "Fictitious: registration help is open." },
        { id: "b", level: "EMERGENCY", message: "Fictitious: camp is closed today.", linkHref: "https://imsda.example/closed", linkLabel: "Read more" },
      ],
    }));
    expect(html).toContain('<section aria-label="Site notices" class="site-notices">');
    expect(position(html, "Emergency: </strong>Fictitious: camp is closed today.")).toBeGreaterThan(-1);
    expect(position(html, "Emergency: ")).toBeLessThan(position(html, "Notice: "));
    expect(html).toContain('<a class="site-notice-link" href="https://imsda.example/closed">Read more</a>');
    expect(html).toContain("site-notice-emergency");
  });

  it("draws the footer verse, contact lines and links, and lets staff clear the verse", async () => {
    const footer = { verse: "Be kind. Ephesians 4:32", contactLines: ["Fictitious Conference Office", "(515) 555-0100"], links: [{ label: "Privacy", href: "/privacy" }] };
    const html = await render(withContent({ footer }));
    expect(html).toContain('<cite>Ephesians 4:32</cite>');
    expect(html).toContain('<p class="home-footer-contact">(515) 555-0100</p>');
    expect(html).toContain('<nav aria-label="Footer links" class="home-footer-links">');
    expect(html).toContain('href="/privacy"');
    expect(await render(withContent({ footer: { ...footer, verse: undefined } }))).not.toContain("home-footer-verse");
  });

  it("hides the closing-soon box when staff turn that section off", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T15:00:00Z"));
    try {
      mocks.listPublicCalendarItems.mockResolvedValue([{
        key: "event-5", kind: "EVENT", title: "Fictitious Camp", startsOn: "2026-11-05", endsOn: "2026-11-06", timeLabel: "", location: "", description: "", category: "Youth",
        status: "SCHEDULED", href: "/events/camp-5", registrationOpen: true, registrationStatus: "OPEN", registrationClosesOn: "2026-11-02", registrationTimeZone: "America/Chicago",
      }]);
      expect(await render(defaultHubContent())).toContain("season-closing-heading");
      const off = withContent({ sections: defaultHubContent().sections.map((section) => (section.key === "closing-soon" ? { ...section, visible: false } : section)) });
      expect(await render(off)).not.toContain("season-closing-heading");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("featured events on the homepage", () => {
  const calendarItem = (slug: string) => ({
    key: `event-${slug}`, kind: "EVENT", title: `Fictitious ${slug}`, startsOn: "2026-11-05", endsOn: "2026-11-06", timeLabel: "", location: "", description: "", category: "Youth",
    status: "SCHEDULED", href: `/events/${slug}`, registrationOpen: true,
  });
  const row = (slug: string) => ({ slug, featuredOrder: 1, featureUntil: null, startsOn: "2026-11-05", endsOn: "2026-11-06" });

  it("shows the chosen events when they have calendar cards, and not the flagged ones", async () => {
    mocks.listPublicCalendarItems.mockResolvedValue([calendarItem("chosen"), calendarItem("flagged")]);
    mocks.curated.mockResolvedValue([row("chosen")]);
    mocks.flagged.mockResolvedValue([row("flagged")]);
    const html = await render(withContent({ featuredEventIds: ["e1"] }));
    expect(html).toContain("Fictitious chosen");
    expect(mocks.flagged).not.toHaveBeenCalled();
    expect(html).toContain("home-featured-heading");
  });

  it("falls back to the flagged events when no chosen event has a public calendar card, even though the chosen events still qualify", async () => {
    mocks.listPublicCalendarItems.mockResolvedValue([calendarItem("flagged")]);
    mocks.curated.mockResolvedValue([row("outside-the-calendar-window")]);
    mocks.flagged.mockResolvedValue([row("flagged")]);
    const html = await render(withContent({ featuredEventIds: ["e1"] }));
    expect(mocks.flagged).toHaveBeenCalledTimes(1);
    expect(html).toContain("Fictitious flagged");
    expect(html).not.toContain("outside-the-calendar-window");
  });
});

describe("pieces shared by the public pages", () => {
  it("draws nothing for no notices and no header links, so the pages are unchanged", () => {
    expect(renderToStaticMarkup(createElement(SiteNoticesView, { notices: [] }))).toBe("");
    expect(renderToStaticMarkup(createElement(PublicHeaderNavLinks, { links: [] }))).toBe("");
  });

  it("draws header links as a labelled list: a site path as a link, an https address as a plain link", () => {
    const html = renderToStaticMarkup(createElement(PublicHeaderNavLinks, { links: [{ label: "Camp", href: "/events" }, { label: "Conference", href: "https://imsda.example" }] }));
    expect(html).toContain('<nav aria-label="Site links" class="public-header-nav">');
    expect(html).toContain('href="/events"');
    expect(html).toContain('href="https://imsda.example"');
  });
});

describe("featured events chosen by staff", () => {
  const event = (id: string, overrides: Record<string, unknown> = {}) => ({
    id, slug: `slug-${id}`, name: `Fictitious ${id}`, startsAt: new Date("2026-11-10T15:00:00Z"), endsAt: new Date("2026-11-12T15:00:00Z"), timezone: "America/Chicago",
    isPublished: true, archivedAt: null, showOnCalendar: true, ...overrides,
  });
  /** The query's own conditions, applied to a few synthetic events, so a private or unpublished one is filtered the way the database would. */
  const store = [
    event("a"), event("b"),
    event("hidden", { showOnCalendar: false }),
    event("draft", { isPublished: false }),
    event("old", { archivedAt: new Date("2026-01-01T00:00:00Z") }),
    event("past", { startsAt: new Date("2026-09-01T15:00:00Z"), endsAt: new Date("2026-09-02T15:00:00Z") }),
  ];
  beforeEach(() => {
    mocks.eventFindMany.mockImplementation(async ({ where }: any) => store.filter((row) => (
      (!where.id || where.id.in.includes(row.id)) && row.isPublished === where.isPublished && row.archivedAt === where.archivedAt && row.showOnCalendar === where.showOnCalendar
    )));
  });

  it("keeps the chosen order and drops private, unpublished, archived, ended and unknown events without a trace", async () => {
    const { listCuratedFeaturedRows } = await realFeatured();
    const rows = await listCuratedFeaturedRows(["b", "hidden", "nope", "draft", "old", "past", "a"], "2026-10-28");
    expect(rows.map((row) => row.slug)).toEqual(["slug-b", "slug-a"]);
    expect(JSON.stringify(rows)).not.toMatch(/hidden|draft|nope|Fictitious/);
  });

  it("is empty for no ids and does not query at all", async () => {
    const { listCuratedFeaturedRows } = await realFeatured();
    expect(await listCuratedFeaturedRows([], "2026-10-28")).toEqual([]);
    expect(mocks.eventFindMany).not.toHaveBeenCalled();
  });
});
