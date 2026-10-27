import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listPublicCalendarItems: vi.fn(),
  getCurrentSession: vi.fn(),
  getCurrentAttendee: vi.fn(),
  headerState: { staffSignedIn: false, attendeeSignedIn: false, unifiedSignInEnabled: false },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/calendar/repository", () => ({
  conferenceToday: () => "2026-09-23",
  listPublicCalendarItems: mocks.listPublicCalendarItems,
}));
const featured = vi.hoisted(() => ({ rows: vi.fn(), images: vi.fn() }));
vi.mock("@/modules/events/featured", () => ({ listFeaturedEventRows: featured.rows, listEventCardImages: featured.images }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
// An async server component cannot render inside renderToStaticMarkup, so this stands in for it with the same presentational links (#1009).
vi.mock("@/components/public-header-session-links", async () => {
  const { createElement } = await import("react");
  const { PublicHeaderLinks } = await import("@/components/public-header-links");
  return { PublicHeaderSessionLinks: () => createElement(PublicHeaderLinks, mocks.headerState) };
});
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));

import Home from "@/app/page";

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
    expect(html).toContain("Nothing is on the calendar yet");
  });

  it("shows a Sign in link to a signed-out visitor, to /sign-in only when single sign-in is on (#1009)", async () => {
    const off = await render();
    expect(off).toContain('href="/account/sign-in"');
    expect(off).not.toContain('href="/sign-in"');
    mocks.headerState = { ...mocks.headerState, unifiedSignInEnabled: true };
    const on = await render();
    expect(on).toContain('href="/sign-in"');
  });

  it("lists the next six public calendar items from today", async () => {
    mocks.listPublicCalendarItems.mockResolvedValue(Array.from({ length: 8 }, (_, i) => item(i + 1)));
    const html = await render();
    expect(mocks.listPublicCalendarItems).toHaveBeenCalledWith("2026-09-23", expect.any(String));
    expect(html).toContain("Fictitious Camp 6");
    expect(html).not.toContain("Fictitious Camp 7");
    expect(html).toMatch(/<a class="primary-button home-calendar-button" href="\/calendar\?view=list">/);
    expect(html).toContain("See the full calendar");
  });

  it("puts Coming up right after the banner, before the links and the start-a-club line (#1204)", async () => {
    mocks.listPublicCalendarItems.mockResolvedValue([item(1)]);
    const html = await render();
    const banner = html.indexOf("public-home-banner");
    const upcoming = html.indexOf("Coming up");
    const links = html.indexOf('aria-label="Get started"');
    const start = html.indexOf("start-a-club-line");
    expect(banner).toBeGreaterThan(-1);
    expect(upcoming).toBeGreaterThan(banner);
    expect(links).toBeGreaterThan(upcoming);
    expect(start).toBeGreaterThan(links);
    expect(html).toContain('href="/clubs/register"');
    expect(html).not.toContain("home-action ");
  });

  it("words each event's status from the shared helper (#1204)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T15:00:00Z"));
    mocks.listPublicCalendarItems.mockResolvedValue([
      { ...item(1), registrationOpen: false, registrationStatus: "UPCOMING", registrationOpensOn: "2026-12-01", clubEvent: true },
      { ...item(2), registrationStatus: "OPEN" },
      { ...item(3), registrationOpen: false, registrationStatus: "OPENING_SOON" },
    ]);
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
    expect(html).toContain("Signed in as Pat Example");
  });
});

describe("featured events and the Coming up strip (#1218, #1210)", () => {
  it("shows no Featured section when nothing is featured, and Coming up is a labelled list of linked cards", async () => {
    mocks.listPublicCalendarItems.mockResolvedValue([item(1), item(2)]);
    const html = await render();
    expect(html).not.toContain("home-featured-heading");
    expect(html).toContain('<ul aria-labelledby="home-upcoming-heading" class="event-photo-list">');
    expect(html).toContain('href="/events/camp-1">Fictitious Camp 1</a>');
    expect(html).toContain('href="/calendar?view=list">See all');
  });

  it("leads with featured events and leaves them out of Coming up", async () => {
    mocks.listPublicCalendarItems.mockResolvedValue([item(1), item(2), item(3)]);
    featured.rows.mockResolvedValue([{ slug: "camp-2", featuredOrder: 1, featureUntil: null, startsOn: "2026-10-02", endsOn: "2026-10-02" }]);
    featured.images.mockResolvedValue(new Map([["camp-2", { assetId: "asset-9" }]]));
    const html = await render();
    expect(html.indexOf("home-featured-heading")).toBeLessThan(html.indexOf("home-upcoming-heading"));
    expect(html.split('href="/events/camp-2"').length - 1).toBe(1);
    expect(html).toContain("/api/public/events/camp-2/assets/asset-9?w=640");
    expect(html).toContain("event-photo-card-featured");
    expect(html.slice(html.indexOf("home-upcoming-heading"))).not.toContain("Fictitious Camp 2");
  });
});
