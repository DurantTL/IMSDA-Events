import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ComingUpPage, NeedsYouPage } from "@/components/home-pages";
import { areaLandingHref, areaTabs, homeDestinations, railItems, registeredDestination, staffPlaceFor, tabIsOwned, visibleAreas, type StaffAreaViewer } from "@/components/staff-areas";
import { phoneBarCurrent, phoneBarItems } from "@/components/staff-phone-bar-model";
import { staffSubpageTitle } from "@/components/staff-navigation";
import type { EventTab } from "@/components/staff-event-tabs";
import { buildEventsAdminHome, type EventsAdminEventSource } from "@/modules/events/events-admin-home-model";
import { buildAttentionSummary, type AttentionSignals } from "@/modules/system-admin/attention-model";
import {
  buildComingUp,
  buildNeedsView,
  needsYouTabCount,
  sectionStatusText,
  type ComingUpEventSource,
} from "@/modules/system-admin/home-needs-model";

vi.mock("next/navigation", () => ({ usePathname: () => "/home", useRouter: () => ({ push: vi.fn() }) }));

const now = new Date("2026-11-07T18:00:00Z");
const none = { total: 0, topEventId: null };
const signals = (patch: Partial<AttentionSignals> = {}): AttentionSignals => ({
  now,
  clubApplicationsWaiting: 0,
  pendingTeams: none,
  cancellationRequestsWaiting: none,
  staffInvitationApprovals: none,
  directoryReview: none,
  emailFailed: none,
  emailStuck: none,
  outboxSweep: "ok",
  scheduledEmailsOverdue: none,
  scheduledEmailsFailed: none,
  unreadableChecks: 0,
  directoryReviewTruncated: false,
  ...patch,
});

const base: StaffAreaViewer = { isSystemAdmin: false, held: [], activeRole: null, hasEvents: true, siteContentEditor: false, healthImport: true, clubYear: null, counts: {} };

describe("Home area tabs and rail (#1568)", () => {
  it("has the two Home tabs for every viewer, named once in the registry", () => {
    for (const viewer of [base, { ...base, held: ["CLUBS_ADMIN"] as const }, { ...base, isSystemAdmin: true, held: ["CLUBS_ADMIN", "SYSTEM_ADMIN"] as const }]) {
      expect(areaTabs("home", viewer as StaffAreaViewer).map((tab) => [tab.label, tab.href])).toEqual([
        ["Needs you", "/home"],
        ["Coming up", "/home/coming-up"],
      ]);
    }
    expect(registeredDestination("/home").label).toBe(homeDestinations.needsYou.label);
    expect(registeredDestination("/home/coming-up").label).toBe(homeDestinations.comingUp.label);
  });

  it("puts Home first on the rail for every viewer and lights it for its pages, Help and Profile", () => {
    for (const viewer of [base, { ...base, hasEvents: false }, { ...base, held: ["EVENTS_ADMIN"] as const }]) {
      expect(visibleAreas(viewer as StaffAreaViewer)[0]).toBe("home");
      expect(railItems(viewer as StaffAreaViewer, null)[0]).toMatchObject({ area: "home", href: "/home" });
    }
    expect(areaLandingHref("home", base)).toBe("/home");
    expect(staffPlaceFor("/home")).toEqual({ area: "home", tab: "needs-you", view: null, inEvent: false });
    expect(staffPlaceFor("/home/coming-up")).toEqual({ area: "home", tab: "coming-up", view: null, inEvent: false });
    expect(staffPlaceFor("/help").area).toBe("home");
    expect(staffPlaceFor("/profile")).toMatchObject({ area: "home", tab: null });
    for (const tab of areaTabs("home", base)) expect(tabIsOwned("home", tab)).toBe(true);
    expect(staffSubpageTitle("/home")).toBe("Home");
    expect(staffSubpageTitle("/home/coming-up")).toBe("Home");
  });

  it("shows the Needs you count only when every held role's count was read and the sum is above zero", () => {
    const count = (viewer: StaffAreaViewer) => areaTabs("home", viewer)[0].count;
    expect(count({ ...base, held: ["EVENTS_ADMIN", "CLUBS_ADMIN"], counts: { EVENTS_ADMIN: 2, CLUBS_ADMIN: 3 } })).toBe(5);
    // A held role whose count could not be read: a partial sum would understate, so no badge.
    expect(count({ ...base, held: ["EVENTS_ADMIN", "CLUBS_ADMIN"], counts: { CLUBS_ADMIN: 3 } })).toBeUndefined();
    expect(count({ ...base, held: ["EVENTS_ADMIN"], counts: { EVENTS_ADMIN: 0 } })).toBeUndefined();
    expect(count({ ...base, held: [], counts: {} })).toBeUndefined();
    // A system administrator's System count already holds the waiting club applications: not added twice.
    expect(needsYouTabCount(["CLUBS_ADMIN", "SYSTEM_ADMIN"], { CLUBS_ADMIN: 2, SYSTEM_ADMIN: 5 })).toBe(5);
    expect(needsYouTabCount(["CLUBS_ADMIN", "SYSTEM_ADMIN"], { CLUBS_ADMIN: 2 })).toBeUndefined();
  });
});

describe("phone bar with Home (#1568)", () => {
  const eventTabs = [{ key: "home", label: "Event home", href: "/overview?event=e1" }, { key: "check-in", label: "Check-in", href: "/check-in?event=e1" }] as unknown as EventTab[];

  it("opens /home from the Home slot and gives no page two bar links", () => {
    for (const viewer of [base, { ...base, held: ["CLUBS_ADMIN"] as const }, { ...base, held: ["EVENTS_ADMIN"] as const }, { ...base, isSystemAdmin: true, held: ["CLUBS_ADMIN", "SYSTEM_ADMIN"] as const }]) {
      const rail = railItems(viewer as StaffAreaViewer, "/overview?event=e1");
      const items = phoneBarItems({ rail, eventTabs, moreHref: "/help" });
      expect(items[0]).toMatchObject({ key: "home", href: "/home" });
      const paths = items.map((item) => item.href.split("?")[0]);
      expect(new Set(paths).size).toBe(paths.length);
    }
  });

  it("lights Home for its pages and More for Help and Profile", () => {
    const items = phoneBarItems({ rail: railItems(base, "/overview?event=e1"), eventTabs, moreHref: "/help" });
    expect(phoneBarCurrent(items, staffPlaceFor("/home"), null)).toBe("home");
    expect(phoneBarCurrent(items, staffPlaceFor("/home/coming-up"), null)).toBe("home");
    expect(phoneBarCurrent(items, staffPlaceFor("/help"), null)).toBe("more");
    expect(phoneBarCurrent(items, staffPlaceFor("/profile"), null)).toBe("more");
    // Staff with no Events row: Events opens the event's first tab and lights only there; the other tabs are in More.
    expect(phoneBarCurrent(items, staffPlaceFor("/overview"), "home", "home")).toBe("events");
    expect(phoneBarCurrent(items, staffPlaceFor("/finance"), "money", "home")).toBe("more");
  });
});

const eventSource = (patch: Partial<EventsAdminEventSource> = {}): EventsAdminEventSource => ({
  id: "evt_1",
  slug: "synthetic",
  name: "Synthetic Camp Meeting",
  startsAt: new Date("2026-12-01T15:00:00Z"),
  endsAt: new Date("2026-12-03T15:00:00Z"),
  timezone: "America/Chicago",
  location: "Synthetic Grounds",
  capacity: 100,
  archivedAt: null,
  isPublished: true,
  registrationOpensOn: null,
  registrationClosesOn: null,
  registrations: [],
  billingMode: "ATTENDEE_PAY",
  draftRegistrationCount: 2,
  failedEmailCount: 1,
  ...patch,
} as unknown as EventsAdminEventSource);

describe("Needs you model (#1568)", () => {
  const eventsHome = buildEventsAdminHome([eventSource()], now);

  it("makes one section per held role, in role order, and only for held roles", () => {
    const view = buildNeedsView({
      held: ["EVENTS_ADMIN", "CLUBS_ADMIN"],
      events: eventsHome,
      clubs: { applications: 3, lateRecords: 0 },
      attention: buildAttentionSummary(signals({ clubApplicationsWaiting: 9 })),
    });
    expect(view.sections.map((section) => section.role)).toEqual(["EVENTS_ADMIN", "CLUBS_ADMIN"]);
    expect(view.noAdminRole).toBe(false);
    const events = view.sections[0];
    // Open balances read zero here, so only the drafts row and the failed messages row are listed; messages are not in the role count.
    expect(events.items.map((item) => item.key)).toEqual(["incomplete-forms", "messages"]);
    expect(events.total).toBe(2);
    expect(events.items[0].links[0].href).toBe("/people?filter=DRAFT&event=evt_1");
    expect(view.sections[1].items.map((item) => [item.key, item.count])).toEqual([["club-applications", 3]]);
    expect(view.sections[1].total).toBe(3);
  });

  it("lists late Monthly Records beside the applications without adding them in", () => {
    const view = buildNeedsView({ held: ["CLUBS_ADMIN"], clubs: { applications: 1, lateRecords: 4 } });
    const clubs = view.sections[0];
    expect(clubs.items.map((item) => [item.key, item.count, item.counted])).toEqual([["club-applications", 1, true], ["late-records", 4, false]]);
    expect(clubs.total).toBe(1);
  });

  it("gives a system administrator the attention items, with club applications under Clubs only", () => {
    const attention = buildAttentionSummary(signals({ clubApplicationsWaiting: 2, emailFailed: { total: 3, topEventId: "evt_1" } }));
    const view = buildNeedsView({ held: ["CLUBS_ADMIN", "SYSTEM_ADMIN"], clubs: { applications: 2, lateRecords: 0 }, attention });
    const system = view.sections.find((section) => section.role === "SYSTEM_ADMIN")!;
    expect(system.items.map((item) => item.key)).toEqual(["email-failed"]);
    expect(system.items[0].links).toEqual([{ label: "Open", href: "/communications?view=deliveries&event=evt_1" }]);
    expect(system.total).toBe(3);
  });

  it("shows Unavailable for a source that failed, never zero, nothing waiting or all clear", () => {
    const failed = buildNeedsView({ held: ["EVENTS_ADMIN", "CLUBS_ADMIN", "SYSTEM_ADMIN"], events: null, clubs: { applications: null, lateRecords: null }, attention: null });
    for (const section of failed.sections) {
      expect(section.unavailable, section.role).toBe(true);
      expect(section.clear, section.role).toBe(false);
      expect(section.total, section.role).toBeNull();
      expect(sectionStatusText(section), section.role).toBe("Unavailable");
      expect(section.items.every((item) => item.count === null), section.role).toBe(true);
    }
    expect(failed.allClear).toBe(false);
    // One failed read among good ones still blocks "nothing needs you".
    const partial = buildNeedsView({ held: ["CLUBS_ADMIN"], clubs: { applications: 0, lateRecords: null } });
    expect(partial.allClear).toBe(false);
    expect(partial.sections[0].items.map((item) => [item.key, item.count])).toEqual([["late-records", null]]);
    // A partial attention summary lists the unreadable check as Unavailable.
    const attention = buildAttentionSummary(signals({ unreadableChecks: 1, unreadableKeys: ["email-stuck"] }));
    const system = buildNeedsView({ held: ["SYSTEM_ADMIN"], attention }).sections[0];
    expect(system.items.map((item) => [item.key, item.count])).toEqual([["email-stuck", null]]);
    expect(system.total).toBeNull();
  });

  it("says nothing needs you only when every read worked and found nothing", () => {
    const view = buildNeedsView({ held: ["EVENTS_ADMIN", "CLUBS_ADMIN", "SYSTEM_ADMIN"], events: buildEventsAdminHome([], now), clubs: { applications: 0, lateRecords: 0 }, attention: buildAttentionSummary(signals()) });
    expect(view.allClear).toBe(true);
    expect(view.sections.map((section) => sectionStatusText(section))).toEqual(["Nothing waiting", "Nothing waiting", "Nothing waiting"]);
    const html = renderToStaticMarkup(createElement(NeedsYouPage, { view }));
    expect(html).toContain("Nothing needs you right now.");
  });

  it("tells staff with no admin role that work is on each event's page, with no fake items", () => {
    const view = buildNeedsView({ held: [] });
    expect(view).toEqual({ noAdminRole: true, sections: [], allClear: false });
    const html = renderToStaticMarkup(createElement(NeedsYouPage, { view }));
    expect(html).toContain("listed on each event");
    expect(html).toContain('href="/home/coming-up"');
    expect(html).not.toContain("Nothing needs you right now.");
  });

  it("renders Unavailable in words and every item as a link only", () => {
    const view = buildNeedsView({ held: ["CLUBS_ADMIN"], clubs: { applications: null, lateRecords: 2 } });
    const html = renderToStaticMarkup(createElement(NeedsYouPage, { view }));
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("Nothing needs you right now.");
    expect(html).toContain('href="/admin/clubs/summary?view=records#monthly-records"');
    expect(html).not.toMatch(/<button|<form/);
  });
});

describe("Coming up model (#1568)", () => {
  // ICU puts thin spaces around the range dash.
  const plain = (text: string) => text.replace(/[\u2009\u202f\u00a0]/g, " ");
  const source = (id: string, name: string, startsAt: string, patch: Partial<ComingUpEventSource> = {}): ComingUpEventSource => ({
    id,
    name,
    startsAt: new Date(startsAt),
    endsAt: new Date(new Date(startsAt).getTime() + 2 * 86_400_000),
    timezone: "America/Chicago",
    location: "Synthetic Grounds",
    isPublished: true,
    archivedAt: null,
    ...patch,
  });

  it("lists upcoming events soonest first, leaving out ended and archived ones", () => {
    const list = buildComingUp(
      [
        source("late", "Later", "2027-02-01T15:00:00Z"),
        source("past", "Over", "2026-09-01T15:00:00Z"),
        source("arch", "Archived", "2026-12-01T15:00:00Z", { archivedAt: new Date("2026-10-01T00:00:00Z") }),
        source("soon", "Sooner", "2026-12-01T15:00:00Z", { isPublished: false, location: null }),
        source("now", "In progress", "2026-11-06T15:00:00Z"),
      ],
      now,
    );
    expect(list.map((event) => event.id)).toEqual(["now", "soon", "late"]);
    expect(list[1]).toMatchObject({ place: "Location not set", status: { text: "Not published" }, href: "/overview?event=soon" });
    expect(plain(list[1].dates)).toBe("Dec 1 – 3, 2026");
    expect(list[0].status.text).toBe("Published");
  });

  it("draws the event in its own time zone", () => {
    const [event] = buildComingUp([source("tz", "Zone", "2026-12-01T03:00:00Z", { timezone: "Pacific/Honolulu" })], now);
    expect(plain(event.dates)).toBe("Nov 30 – Dec 2, 2026");
  });

  it("renders rows as links, the empty state and Unavailable", () => {
    const list = buildComingUp([source("a", "Synthetic Camp Meeting", "2026-12-01T15:00:00Z")], now);
    const html = renderToStaticMarkup(createElement(ComingUpPage, { events: list }));
    expect(html).toContain('href="/overview?event=a"');
    expect(html).toContain("Published");
    expect(renderToStaticMarkup(createElement(ComingUpPage, { events: [] }))).toContain("No upcoming events.");
    const failed = renderToStaticMarkup(createElement(ComingUpPage, { events: null }));
    expect(failed).toContain("Unavailable");
    expect(failed).not.toContain("No upcoming events.");
  });
});
