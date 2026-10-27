import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listPublicCalendarItems: vi.fn(),
  getCurrentAttendee: vi.fn(),
  listDirectedClubs: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/calendar/repository", () => ({
  conferenceToday: () => "2026-10-27",
  listPublicCalendarItems: mocks.listPublicCalendarItems,
}));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: mocks.listDirectedClubs }));
vi.mock("@/components/public-header-session-links", () => ({ PublicHeaderSessionLinks: () => null }));

import OpenForRegistrationPage from "@/app/(public)/events/page";
import type { CalendarItem } from "@/modules/calendar/domain";
import {
  openRegistrationHref,
  parseOpenRegistrationFilter,
  selectOpenRegistrationItems,
} from "@/modules/calendar/open-registration";

const item = (slug: string, overrides: Partial<CalendarItem> = {}): CalendarItem => ({
  key: `event-${slug}`,
  kind: "EVENT",
  title: `Fictitious ${slug} Weekend`,
  description: "",
  startsOn: "2026-11-10",
  endsOn: "2026-11-12",
  timeLabel: "",
  location: "Example Campground",
  category: "",
  href: `/events/${slug}`,
  status: "SCHEDULED",
  registrationOpen: true,
  registrationStatus: "OPEN",
  registrationOpensOn: null,
  clubEvent: false,
  ...overrides,
});

async function render(forValue?: string) {
  return renderToStaticMarkup(await OpenForRegistrationPage({ searchParams: Promise.resolve(forValue ? { for: forValue } : {}) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-27T15:00:00Z"));
  mocks.listPublicCalendarItems.mockResolvedValue([]);
  mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
  mocks.listDirectedClubs.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("selectOpenRegistrationItems (#1217)", () => {
  const all = [
    item("open", { startsOn: "2026-12-01", endsOn: "2026-12-02" }),
    item("waitlist", { registrationStatus: "WAITLIST", startsOn: "2026-11-20", endsOn: "2026-11-20" }),
    item("full", { registrationStatus: "FULL", registrationOpen: false, startsOn: "2026-11-25", endsOn: "2026-11-25" }),
    item("soon", { registrationStatus: "OPENING_SOON", registrationOpen: false, startsOn: "2027-01-05", endsOn: "2027-01-05" }),
    item("later", { registrationStatus: "UPCOMING", registrationOpen: false, clubEvent: true, startsOn: "2027-02-01", endsOn: "2027-02-01" }),
    item("closed", { registrationStatus: "CLOSED", registrationOpen: false }),
    item("draft", { registrationStatus: "DRAFT", registrationOpen: false }),
    item("cancelled", { status: "CANCELLED" }),
    item("closure", { isClosure: true }),
    { ...item("entry"), kind: "ENTRY" as const, registrationStatus: undefined },
    item("club", { clubEvent: true, startsOn: "2026-11-15", endsOn: "2026-11-15" }),
  ];

  it("keeps open, waitlist, full, opening soon and upcoming, soonest first; drops closed, draft, cancelled, closures and entries", () => {
    expect(selectOpenRegistrationItems(all).map((i) => i.href)).toEqual([
      "/events/club", "/events/waitlist", "/events/full", "/events/open", "/events/soon", "/events/later",
    ]);
  });

  it("filters Club events and Everyone", () => {
    expect(selectOpenRegistrationItems(all, "clubs").map((i) => i.href)).toEqual(["/events/club", "/events/later"]);
    expect(selectOpenRegistrationItems(all, "everyone").map((i) => i.href)).toEqual([
      "/events/waitlist", "/events/full", "/events/open", "/events/soon",
    ]);
  });

  it("shows an event linked from several calendar items once, at its earliest date", () => {
    const rows = [
      item("camp", { key: "b", startsOn: "2026-12-05", endsOn: "2026-12-05" }),
      item("camp", { key: "a", startsOn: "2026-11-05", endsOn: "2026-11-05" }),
    ];
    const result = selectOpenRegistrationItems(rows);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("a");
  });

  it("falls back to All for an unknown value", () => {
    expect(parseOpenRegistrationFilter("clubs")).toBe("clubs");
    expect(parseOpenRegistrationFilter(["everyone", "clubs"])).toBe("everyone");
    expect(parseOpenRegistrationFilter("bogus")).toBe("all");
    expect(parseOpenRegistrationFilter(undefined)).toBe("all");
    expect(openRegistrationHref("all")).toBe("/events");
    expect(openRegistrationHref("clubs")).toBe("/events?for=clubs");
  });
});

describe("the /events page (#1217)", () => {
  const rows = () => [
    item("spring-camporee", { title: "Fictitious Spring Camporee", clubEvent: true, startsOn: "2026-11-10", endsOn: "2026-11-12" }),
    item("family-day", { title: "Fictitious Family Day", startsOn: "2026-11-20", endsOn: "2026-11-20" }),
    item("closed-camp", { registrationStatus: "CLOSED", registrationOpen: false }),
  ];

  it("asks the calendar for the public window starting today, about 18 months", async () => {
    await render();
    const [from, to] = mocks.listPublicCalendarItems.mock.calls[0];
    expect(from).toBe("2026-10-27");
    expect(to).toBe("2028-04-27");
  });

  it("has one h1, an h2, and card links with full names", async () => {
    mocks.listPublicCalendarItems.mockResolvedValue(rows());
    const html = await render();
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain("Open for registration</h1>");
    expect(html).toMatch(/<h2 class="sr-only"[^>]*>Events open for registration<\/h2>/);
    expect(html).toContain('<a href="/events/spring-camporee">Fictitious Spring Camporee</a>');
    expect(html).toContain('<a href="/events/family-day">Fictitious Family Day</a>');
    expect(html).not.toContain("closed-camp");
    expect(html).toContain("Example Campground");
    expect(html).toContain("November 10–12, 2026");
    expect(html).toContain("Registration open");
    expect(html).not.toContain("Read more");
  });

  it("marks the active filter with aria-current and links all three by plain links", async () => {
    mocks.listPublicCalendarItems.mockResolvedValue(rows());
    const all = await render();
    expect(all).toMatch(/<a aria-current="page" href="\/events">All<\/a>/);
    expect(all).toContain('href="/events?for=clubs"');
    expect(all).toContain('href="/events?for=everyone"');
    const clubs = await render("clubs");
    expect(clubs).toMatch(/<a aria-current="page" href="\/events\?for=clubs">Club events<\/a>/);
    expect(clubs).toContain("Fictitious Spring Camporee");
    expect(clubs).not.toContain("Fictitious Family Day");
    const everyone = await render("everyone");
    expect(everyone).toMatch(/<a aria-current="page" href="\/events\?for=everyone">Everyone<\/a>/);
    expect(everyone).toContain("Fictitious Family Day");
    expect(everyone).not.toContain("Fictitious Spring Camporee");
    const unknown = await render("nonsense");
    expect(unknown).toMatch(/<a aria-current="page" href="\/events">All<\/a>/);
  });

  it("tells visitors clubs register through their director, with no Register button", async () => {
    mocks.listPublicCalendarItems.mockResolvedValue(rows());
    const html = await render();
    expect(html).toContain("Clubs register through their director");
    expect(html).not.toContain("Register your club");
    expect(html.match(/Clubs register through their director/g)).toHaveLength(1);
  });

  it("offers Register your club, to the club entry flow, to a signed-in director", async () => {
    mocks.listPublicCalendarItems.mockResolvedValue(rows());
    mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "acct-1" }, via: "attendee", sessionId: "s" });
    mocks.listDirectedClubs.mockResolvedValue([{ organizationId: "org-1", name: "Fictitious Club", role: "DIRECTOR", sponsoringChurch: null }]);
    const html = await render();
    expect(html).toContain('href="/account/club-registration/spring-camporee"');
    expect(html).toContain("Register your club");
    expect(html).not.toContain("Clubs register through their director");
  });

  it("shows the empty state with a calendar link, for every filter", async () => {
    for (const value of [undefined, "clubs", "everyone"]) {
      const html = await render(value);
      expect(html).toContain("No events are open for registration right now");
      expect(html).toContain('href="/calendar"');
      expect(html).not.toContain("<ul");
    }
    expect(await render("clubs")).toContain("for clubs");
    expect(await render("everyone")).toContain("for everyone");
  });

  it("shows the empty state when only closed events remain", async () => {
    mocks.listPublicCalendarItems.mockResolvedValue([item("x", { registrationStatus: "CLOSED", registrationOpen: false })]);
    expect(await render()).toContain("No events are open for registration right now");
  });
});

describe("what the page can never list (#1217)", () => {
  it("takes its items only from listPublicCalendarItems, whose query excludes draft, private and archived events", () => {
    const page = readFileSync("app/(public)/events/page.tsx", "utf8");
    expect(page).toContain("listPublicCalendarItems(");
    expect(page).not.toMatch(/getPrisma|prisma\./);
    const repo = readFileSync("modules/calendar/repository.ts", "utf8");
    const where = repo.slice(repo.indexOf("export async function listPublicCalendarItems"));
    expect(where).toMatch(/isPublished: true,\s*archivedAt: null,\s*showOnCalendar: true/);
  });
});

describe("links to /events", () => {
  const source = (path: string) => readFileSync(path, "utf8");
  it.each([
    ["homepage", "app/page.tsx"],
    ["calendar", "app/(public)/calendar/page.tsx"],
    ["Find a club", "app/(public)/clubs/page.tsx"],
    ["club portal home", "components/club-home.tsx"],
  ])("%s links to the open-registration page", (_name, path) => {
    const text = source(path);
    expect(text).toContain('href="/events"');
    expect(text).toContain("See all events open for registration");
  });
  it("is in the sitemap", () => {
    expect(source("app/sitemap.ts")).toContain("/events`");
  });
});
