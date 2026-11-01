import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listPublicCalendarItems: vi.fn(),
  getCurrentSession: vi.fn(),
  getCurrentAttendee: vi.fn(),
  ministries: vi.fn(),
  help: vi.fn(),
  headerState: { staffSignedIn: false, attendeeSignedIn: false, unifiedSignInEnabled: false },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/calendar/repository", () => ({
  conferenceToday: () => "2026-09-23",
  listPublicCalendarItems: mocks.listPublicCalendarItems,
}));
const featured = vi.hoisted(() => ({ rows: vi.fn(), images: vi.fn() }));
vi.mock("@/modules/events/featured", () => ({ listFeaturedEventRows: featured.rows, listCuratedFeaturedRows: async () => [], listEventCardImages: featured.images }));
vi.mock("@/modules/site-content/hub-content", async () => ({ getPublishedHubContent: async () => (await import("@/modules/site-content/hub-content-domain")).defaultHubContent() }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
// An async server component cannot render inside renderToStaticMarkup, so this stands in for it with the same presentational links (#1009).
vi.mock("@/components/public-header-session-links", async () => {
  const { createElement } = await import("react");
  const { PublicHeaderLinks } = await import("@/components/public-header-links");
  return { PublicHeaderSessionLinks: () => createElement(PublicHeaderLinks, mocks.headerState) };
});
vi.mock("@/modules/system-admin/homepage-ministries", () => ({ listHomepageMinistries: mocks.ministries }));
vi.mock("@/modules/system-admin/platform-settings", () => ({ getPublicHelpContact: mocks.help }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));

import Home from "@/app/page";
import { fallbackHomepageMinistries } from "@/modules/system-admin/homepage-ministries-domain";

const item = (n: number) => ({
  key: `event-${n}`,
  kind: "EVENT",
  title: `Fictitious Camp ${n}`,
  startsOn: `2026-10-${String(n).padStart(2, "0")}`,
  endsOn: `2026-10-${String(n).padStart(2, "0")}`,
  timeLabel: "",
  location: "Example Campground",
  description: "",
  category: "Youth",
  status: "SCHEDULED",
  href: `/events/camp-${n}`,
  registrationOpen: true,
});

async function render() {
  return renderToStaticMarkup(await Home());
}

beforeEach(() => {
  vi.clearAllMocks();
  featured.rows.mockResolvedValue([]);
  featured.images.mockResolvedValue(new Map());
  mocks.listPublicCalendarItems.mockResolvedValue([]);
  mocks.ministries.mockResolvedValue(fallbackHomepageMinistries);
  mocks.help.mockResolvedValue({ phone: null, email: null });
  mocks.getCurrentSession.mockResolvedValue({ user: null });
  mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
  mocks.headerState = { staffSignedIn: false, attendeeSignedIn: false, unifiedSignInEnabled: false };
});

describe("public front page (#373)", () => {
  it("is public: registrations, club and Find a club, with no link to staff sign-in", async () => {
    const html = await render();
    expect(html).toContain('href="/account"');
    expect(html).toContain('href="/account/clubs"');
    expect(html).toContain('<a href="/clubs">');
    expect(html).toContain("My registrations");
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain('href="/overview"');
    expect(html).toContain("The season ahead");
    expect(html).toContain("Nothing scheduled yet.");
  });

  it("shows a Sign in link to a signed-out visitor, to /sign-in only when single sign-in is on (#1009)", async () => {
    const off = await render();
    expect(off).toContain('href="/account/sign-in"');
    expect(off).not.toContain('href="/sign-in"');
    mocks.headerState = { ...mocks.headerState, unifiedSignInEnabled: true };
    const on = await render();
    expect(on).toContain('href="/sign-in"');
  });

  it("reads the calendar from today for a year and offers the full calendar and the full year (#1251)", async () => {
    mocks.listPublicCalendarItems.mockResolvedValue(Array.from({ length: 8 }, (_, i) => item(i + 1)));
    const html = await render();
    expect(mocks.listPublicCalendarItems).toHaveBeenCalledWith("2026-09-23", "2027-09-23");
    expect(html).toMatch(/<a class="primary-button home-calendar-button" href="\/calendar\?view=list">/);
    expect(html).toContain("See the full calendar");
    expect(html).toMatch(/href="\/calendar\?view=year">See the full year/);
    expect(html).not.toContain("Coming up");
  });

  it("orders the page: band, featured, ribbon, Find your place, three-month list, then the links and the start-a-club line (#1251)", async () => {
    mocks.listPublicCalendarItems.mockResolvedValue([{ ...item(5), startsOn: "2026-10-05", endsOn: "2026-10-05" }]);
    featured.rows.mockResolvedValue([{ slug: "camp-5", featuredOrder: 1, featureUntil: null, startsOn: "2026-10-05", endsOn: "2026-10-05" }]);
    const html = await render();
    const order = ["public-home-banner", "home-featured-heading", "home-season-heading", "home-places-heading", "home-months-heading", 'aria-label="Get started"', "start-a-club-line", "home-footer"].map((marker) => html.indexOf(marker));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(html).toContain('href="/clubs/register"');
    expect(html).toContain("<h1>The season ahead</h1>");
  });

  it("puts each item in its lane with its name and date, linked to its page (#1251)", async () => {
    mocks.listPublicCalendarItems.mockResolvedValue([
      { ...item(5), clubEvent: true, endsOn: "2026-10-07" },
      { ...item(9), category: "Camp Meeting" },
      { key: "entry-closed", kind: "ENTRY", title: "Conference office closed", startsOn: "2026-11-26", endsOn: "2026-11-27", timeLabel: "", location: "", description: "", category: "Office closure", status: "SCHEDULED", href: null, registrationOpen: false, isClosure: true },
    ]);
    const html = await render();
    const lane = (name: string) => {
      const start = html.indexOf(`season-lane-${name}`);
      return html.slice(start, html.indexOf("</ul>", start));
    };
    expect(lane("clubs")).toContain("Fictitious Camp 5");
    expect(lane("clubs")).toContain("Oct 5–7");
    expect(lane("clubs")).toContain('href="/events/camp-5"');
    expect(lane("clubs")).not.toContain("Fictitious Camp 9");
    expect(lane("ministries")).toContain("Fictitious Camp 9");
    expect(lane("closed")).toContain("Conference office closed");
    expect(lane("closed")).toContain("Nov 26–27");
  });

  it("shows the closing-soon box with the event's own countdown and a Register link, and hides it when nothing closes soon (#1251)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T15:00:00Z"));
    try {
      mocks.listPublicCalendarItems.mockResolvedValue([{ ...item(5), registrationStatus: "OPEN", registrationClosesOn: "2026-09-28", registrationTimeZone: "America/Chicago" }]);
      const html = await render();
      expect(html).toContain("Closing soon");
      expect(html).toContain("Registration closes in 5 days, on September 28, 2026");
      expect(html).toMatch(/<a class="season-closing-register" href="\/events\/camp-5">Register/);
      mocks.listPublicCalendarItems.mockResolvedValue([{ ...item(5), registrationStatus: "OPEN", registrationClosesOn: "2026-10-30" }]);
      expect(await render()).not.toContain("season-closing-heading");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows each ministry's next item, its closing flag, and nothing extra for a tile with no item (#1251)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T15:00:00Z"));
    try {
      mocks.ministries.mockResolvedValue([
        { position: 1, name: "Pathfinders", description: "Ages 10 to 15.", linkHref: null, categories: ["youth"], icon: "Compass" },
        { position: 2, name: "Adventurers", description: null, linkHref: "/clubs", categories: ["Adventurers"], icon: "Backpack" },
      ]);
      mocks.listPublicCalendarItems.mockResolvedValue([{ ...item(5), registrationStatus: "OPEN", registrationClosesOn: "2026-09-24" }]);
      const html = await render();
      expect(html).toContain('href="/calendar?view=list&amp;category=youth"');
      expect(html).toContain("Ages 10 to 15.");
      expect(html).toContain("Next: Fictitious Camp 5, Oct 5");
      expect(html).toContain("Registration closes tomorrow");
      const adventurers = html.slice(html.indexOf('href="/clubs"><span class="home-place-icon"'));
      expect(adventurers).toContain("Adventurers");
      expect(adventurers.slice(0, adventurers.indexOf("</li>"))).not.toContain("home-place-next");
      expect(adventurers.slice(0, adventurers.indexOf("</li>"))).not.toContain("home-place-desc");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the scripture always and the help line only for the parts that are set (#1251)", async () => {
    let html = await render();
    expect(html).toContain("Not forsaking the assembling of ourselves together.");
    expect(html).toContain("Hebrews 10:25");
    expect(html).not.toContain("Need help?");
    mocks.help.mockResolvedValue({ phone: "(515) 555-0100", email: "help@example.test" });
    html = await render();
    expect(html).toContain('Call <a href="tel:5155550100">(515) 555-0100</a> or email <a href="mailto:help@example.test">help@example.test</a>');
    mocks.help.mockResolvedValue({ phone: null, email: "help@example.test" });
    html = await render();
    expect(html).toContain('Need help? Email <a href="mailto:help@example.test">');
    expect(html).not.toContain("tel:");
  });

  it("words each event's status from the shared helper (#1204)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T15:00:00Z"));
    mocks.listPublicCalendarItems.mockResolvedValue([
      { ...item(1), registrationOpen: false, registrationStatus: "UPCOMING", registrationOpensOn: "2026-12-01", clubEvent: true },
      { ...item(2), registrationStatus: "OPEN" },
      { ...item(3), registrationOpen: false, registrationStatus: "OPENING_SOON" },
    ]);
    // The status line shows on the featured cards (the season view carries dates, not status).
    featured.rows.mockResolvedValue([1, 2, 3].map((n) => ({ slug: `camp-${n}`, featuredOrder: n, featureUntil: null, startsOn: `2026-10-0${n}`, endsOn: `2026-10-0${n}` })));
    const html = await render();
    vi.useRealTimers();
    expect(html).toContain("Club registration opens in December");
    expect(html).toContain("Registration open");
    expect(html).toContain("Registration opening soon");
  });

  it("offers the staff workspace to a signed-in staff member", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.headerState = { staffSignedIn: true, attendeeSignedIn: false, unifiedSignInEnabled: false };
    const html = await render();
    expect(html).toContain('href="/overview"');
    expect(html).not.toContain('href="/login"');
  });

  it("greets a signed-in attendee", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({
      account: { id: "acct-1", verifiedEmail: "parent@example.test", displayName: "Pat Example" },
      via: "attendee",
      sessionId: "s-1",
    });
    const html = await render();
    expect(html).toContain("My registrations");
    expect(html).toContain(`Signed in as <span translate="no">Pat Example</span>`);
  });
});

describe("featured events (#1218, #1251)", () => {
  it("shows no Featured section when nothing is featured", async () => {
    mocks.listPublicCalendarItems.mockResolvedValue([item(1), item(2)]);
    const html = await render();
    expect(html).not.toContain("home-featured-heading");
  });

  it("leads with featured events as photo cards, under the band", async () => {
    mocks.listPublicCalendarItems.mockResolvedValue([item(1), item(2), item(3)]);
    featured.rows.mockResolvedValue([{ slug: "camp-2", featuredOrder: 1, featureUntil: null, startsOn: "2026-10-02", endsOn: "2026-10-02" }]);
    featured.images.mockResolvedValue(new Map([["camp-2", { assetId: "asset-9" }]]));
    const html = await render();
    expect(html.indexOf("public-home-banner")).toBeLessThan(html.indexOf("home-featured-heading"));
    expect(html.indexOf("home-featured-heading")).toBeLessThan(html.indexOf("home-season-heading"));
    expect(html).toContain("/api/public/events/camp-2/assets/asset-9?w=640");
    expect(html).toContain("event-photo-card-featured");
  });
});
