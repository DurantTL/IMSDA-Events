import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listPublicCalendarItems: vi.fn(),
  getCurrentAttendee: vi.fn(),
  listDirectedClubs: vi.fn(),
  listFeaturedEventRows: vi.fn(),
  hubContent: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/calendar/repository", () => ({
  conferenceToday: () => "2026-10-27",
  listPublicCalendarItems: mocks.listPublicCalendarItems,
}));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: mocks.listDirectedClubs }));
vi.mock("@/modules/events/featured", () => ({ listFeaturedEventRows: mocks.listFeaturedEventRows }));
vi.mock("@/modules/site-content/hub-content", () => ({ getPublishedHubContent: mocks.hubContent }));
vi.mock("@/components/public-header-session-links", () => ({ PublicHeaderSessionLinks: () => null }));

import OpenForRegistrationPage from "@/app/(public)/events/page";
import styles from "@/app/(public)/events/events-directory.module.css";
import type { CalendarItem } from "@/modules/calendar/domain";
import { defaultHubContent } from "@/modules/site-content/hub-content-domain";
import {
  applyEventDirectoryFilters,
  eventDirectoryHref,
  eventDirectoryOptions,
  eventDirectoryQueryMaxLength,
  hasActiveDirectoryFilters,
  parseEventDirectoryFilters,
  type EventDirectoryFilters,
} from "@/modules/calendar/event-directory";

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

const none: EventDirectoryFilters = { q: "", from: "", to: "", category: "", location: "", audience: "all" };
const run = (overrides: Partial<EventDirectoryFilters>, items: CalendarItem[]) =>
  applyEventDirectoryFilters(items, { ...none, ...overrides }).map((i) => i.href);

describe("parsing (#106)", () => {
  it("reads every filter, trimmed", () => {
    expect(parseEventDirectoryFilters({ q: "  camp  ", from: "2026-11-01", to: "2026-12-01", category: " Retreat ", location: " Lake ", for: "clubs" }))
      .toEqual({ q: "camp", from: "2026-11-01", to: "2026-12-01", category: "Retreat", location: "Lake", audience: "clubs" });
  });
  it("is empty with no params", () => {
    expect(parseEventDirectoryFilters({})).toEqual(none);
    expect(hasActiveDirectoryFilters(none)).toBe(false);
  });
  it("ignores invalid dates, including impossible ones", () => {
    const parsed = parseEventDirectoryFilters({ from: "11/01/2026", to: "2026-02-31" });
    expect(parsed.from).toBe("");
    expect(parsed.to).toBe("");
  });
  it("swaps a backwards range", () => {
    const parsed = parseEventDirectoryFilters({ from: "2026-12-01", to: "2026-11-01" });
    expect([parsed.from, parsed.to]).toEqual(["2026-11-01", "2026-12-01"]);
  });
  it("takes the first value of an array", () => {
    const parsed = parseEventDirectoryFilters({ q: ["first", "second"], category: ["A", "B"], from: ["2026-11-01", "2026-12-01"] });
    expect([parsed.q, parsed.category, parsed.from]).toEqual(["first", "A", "2026-11-01"]);
  });
  it("caps a long search", () => {
    expect(parseEventDirectoryFilters({ q: "x".repeat(500) }).q).toHaveLength(eventDirectoryQueryMaxLength);
  });
  it("counts any non-audience filter as active", () => {
    expect(hasActiveDirectoryFilters({ ...none, location: "Lake" })).toBe(true);
    expect(hasActiveDirectoryFilters({ ...none, audience: "clubs" })).toBe(false);
  });
});

describe("filtering (#106)", () => {
  const items = [
    item("camp", { title: "Camp Meeting", description: "Worship and meals", location: "Lake Site", category: "Camp" }),
    item("retreat", { title: "Women's Retreat", location: "Hill Lodge", category: "Retreat", startsOn: "2027-02-05", endsOn: "2027-02-07" }),
    item("rally", { title: "Youth Rally", location: "Lake Site", category: "Youth", startsOn: "2026-12-01", endsOn: "2026-12-01" }),
  ];
  it("matches text case-insensitively in every searched field, all words required", () => {
    expect(run({ q: "CAMP" }, items)).toEqual(["/events/camp"]);
    expect(run({ q: "meals" }, items)).toEqual(["/events/camp"]);
    expect(run({ q: "lodge" }, items)).toEqual(["/events/retreat"]);
    expect(run({ q: "lake youth" }, items)).toEqual(["/events/rally"]);
    expect(run({ q: "lake retreat" }, items)).toEqual([]);
  });
  it("searches a linked event's own name", () => {
    expect(run({ q: "gathering" }, [item("x", { title: "Entry", eventTitle: "Big Gathering" })])).toEqual(["/events/x"]);
  });
  it("keeps events overlapping the date range", () => {
    expect(run({ from: "2026-11-12" }, items)).toEqual(["/events/camp", "/events/retreat", "/events/rally"]);
    expect(run({ from: "2026-11-13" }, items)).toEqual(["/events/retreat", "/events/rally"]);
    expect(run({ to: "2026-11-09" }, items)).toEqual([]);
    expect(run({ from: "2026-11-30", to: "2026-12-02" }, items)).toEqual(["/events/rally"]);
  });
  it("uses a linked item's event dates, not the entry's", () => {
    const linked = item("l", { startsOn: "2026-11-01", endsOn: "2026-11-01", eventStartsOn: "2027-03-01", eventEndsOn: "2027-03-03" });
    expect(run({ from: "2027-03-02" }, [linked])).toEqual(["/events/l"]);
    expect(run({ to: "2026-12-31" }, [linked])).toEqual([]);
  });
  it("matches category and location exactly, ignoring case", () => {
    expect(run({ category: "retreat" }, items)).toEqual(["/events/retreat"]);
    expect(run({ category: "Ret" }, items)).toEqual([]);
    expect(run({ location: "LAKE SITE" }, items)).toEqual(["/events/camp", "/events/rally"]);
  });
  it("combines filters", () => {
    expect(run({ location: "Lake Site", from: "2026-11-30" }, items)).toEqual(["/events/rally"]);
    expect(run({ location: "Lake Site", category: "Camp", q: "worship" }, items)).toEqual(["/events/camp"]);
    expect(run({ location: "Hill Lodge", category: "Camp" }, items)).toEqual([]);
  });
});

describe("options and links (#106)", () => {
  const items = [item("a", { category: "Retreat", location: "Lake" }), item("b", { category: "camp", location: "" }), item("c", { category: "Retreat", location: "Hill" })];
  it("lists distinct sorted values and always the selected one", () => {
    expect(eventDirectoryOptions(items, { category: "", location: "" })).toEqual({ categories: ["camp", "Retreat"], locations: ["Hill", "Lake"] });
    expect(eventDirectoryOptions(items, { category: "Youth", location: "" }).categories).toEqual(["camp", "Retreat", "Youth"]);
  });
  it("builds short links without empty params or for=all", () => {
    expect(eventDirectoryHref({})).toBe("/events");
    expect(eventDirectoryHref({ audience: "all", q: " " })).toBe("/events");
    expect(eventDirectoryHref({ audience: "clubs", q: "camp meeting", from: "2026-11-01", location: "Lake" }))
      .toBe("/events?for=clubs&q=camp+meeting&from=2026-11-01&location=Lake");
  });
});

describe("the page (#106)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T15:00:00Z"));
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    mocks.listDirectedClubs.mockResolvedValue([]);
    mocks.listFeaturedEventRows.mockResolvedValue([]);
    mocks.hubContent.mockResolvedValue(defaultHubContent());
    mocks.listPublicCalendarItems.mockResolvedValue([
      item("camp", { title: "Camp Meeting", category: "Camp", location: "Lake Site" }),
      item("retreat", { title: "Women's Retreat", category: "Retreat", location: "Hill Lodge", clubEvent: true }),
    ]);
  });
  afterEach(() => vi.useRealTimers());
  const render = async (params: Record<string, string | string[]> = {}) => renderToStaticMarkup(await OpenForRegistrationPage({ searchParams: Promise.resolve(params) }));

  it("shows a labelled GET form with Any defaults and the option lists", async () => {
    const html = await render();
    expect(html).toContain('action="/events"');
    expect(html).toContain('method="get"');
    for (const [id, label] of [["events-q", "Search events"], ["events-from", "From"], ["events-to", "To"], ["events-category", "Category"], ["events-location", "Location"]]) {
      expect(html).toContain(`<label for="${id}">${label}</label>`);
    }
    expect(html).toContain('<option value="" selected="">Any</option>');
    expect(html).toContain('<option value="Hill Lodge">Hill Lodge</option>');
    expect(html).toContain("Show events");
    expect(html).not.toContain("Clear filters");
    expect(html).toContain("2 events");
    expect(html).toContain(`class="${styles.eventsDirectoryCount}" role="status"`);
    expect(html).toMatch(/id="events-from" max="\d{4}-\d{2}-\d{2}" min="2026-10-27"/);
  });

  it("lets staff order and hide the Category choices (#111) without removing any event from the list", async () => {
    mocks.hubContent.mockResolvedValue({ ...defaultHubContent(), calendarCategories: { order: ["Retreat"], hidden: ["Camp"] } });
    const html = await render();
    const select = html.slice(html.indexOf('id="events-category"'), html.indexOf("</select>", html.indexOf('id="events-category"')));
    expect(select).toContain('<option value="Retreat">Retreat</option>');
    expect(select).not.toContain('value="Camp"');
    expect(html).toContain("2 events");
    expect(html).toContain("Camp Meeting");
    // A category already chosen in the address stays in the choices so the form still shows it.
    expect((await render({ category: "Camp" }))).toContain('<option value="Camp" selected="">Camp</option>');
  });

  it("shows the notices staff published above the list, and not an expired one (#111)", async () => {
    mocks.hubContent.mockResolvedValue({
      ...defaultHubContent(),
      notices: [
        { id: "a", level: "URGENT", message: "Fictitious office closed Friday." },
        { id: "b", level: "INFO", message: "Fictitious old news.", endsOn: "2026-10-01" },
      ],
    });
    const html = await render();
    expect(html).toContain('aria-label="Site notices"');
    expect(html).toContain("Urgent: </strong>Fictitious office closed Friday.");
    expect(html).not.toContain("Fictitious old news.");
  });

  it("reflects URL values, filters, and counts in words", async () => {
    const html = await render({ q: "camp", from: "2026-11-01", category: "Camp" });
    expect(html).toContain('value="camp"');
    expect(html).toContain('value="2026-11-01"');
    expect(html).toContain('<option value="Camp" selected="">Camp</option>');
    expect(html).toContain("1 event<");
    expect(html).toContain("Camp Meeting");
    expect(html).not.toContain("Women&#x27;s Retreat</a>");
    expect(html).toContain("Clear filters");
  });

  it("says nothing matches and offers Clear filters, keeping the audience", async () => {
    const html = await render({ q: "zzz", for: "clubs" });
    expect(html).toContain("No events match these filters.");
    expect(html).toContain('href="/events?for=clubs"');
    expect(html).toContain('<input type="hidden" name="for" value="clubs"/>');
  });

  it("keeps the current empty wording with no filter", async () => {
    mocks.listPublicCalendarItems.mockResolvedValue([]);
    const html = await render();
    expect(html).toContain("No events are open for registration right now.");
    expect(html).not.toContain("No events match these filters.");
  });

  it("keeps active filters in the audience chip links", async () => {
    const html = await render({ q: "camp", location: "Lake Site" });
    expect(html).toContain('href="/events?q=camp&amp;location=Lake+Site"');
    expect(html).toContain('href="/events?for=clubs&amp;q=camp&amp;location=Lake+Site"');
  });

  it("still pins featured events after filtering, and never lists one the filter removed", async () => {
    mocks.listPublicCalendarItems.mockResolvedValue([
      item("a", { title: "Alpha Day", category: "Camp" }),
      item("b", { title: "Beta Day", category: "Camp", startsOn: "2026-11-20", endsOn: "2026-11-21" }),
      item("c", { title: "Gamma Day", category: "Other" }),
    ]);
    mocks.listFeaturedEventRows.mockResolvedValue([{ slug: "b", featuredOrder: 1, featureUntil: null, startsOn: "2026-11-20", endsOn: "2026-11-21" }, { slug: "c", featuredOrder: 2, featureUntil: null, startsOn: "2026-11-10", endsOn: "2026-11-12" }]);
    const html = await render({ category: "Camp" });
    expect(html.indexOf("Beta Day")).toBeLessThan(html.indexOf("Alpha Day"));
    expect(html).toContain('class="open-events-featured"');
    expect(html).not.toContain("Gamma Day");
  });

  it("styles the form for phones with large targets and no overflow, in the page's CSS module", () => {
    const css = readFileSync("app/(public)/events/events-directory.module.css", "utf8");
    expect(css).toContain(".eventsDirectoryForm {");
    expect(readFileSync("app/globals.css", "utf8")).not.toContain("events-directory");
    expect(css).toMatch(/\.eventsDirectoryField input, \.eventsDirectoryField select \{[^}]*min-height: 44px[^}]*font-size: 1rem/);
  });
});
