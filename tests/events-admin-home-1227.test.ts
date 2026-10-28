import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1227: the Events Administrator dashboard. Scope is the security-critical part: only the signed-in person's own
 * active EVENT_ADMIN events are read, never anything from the query string. Synthetic data only.
 */

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  resolveAdminRoles: vi.fn(),
  getEventsAdminEventSources: vi.fn(),
  eventFindMany: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/admin-roles", () => ({ resolveAdminRoles: mocks.resolveAdminRoles }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ event: { findMany: mocks.eventFindMany }, messageOutbox: { groupBy: mocks.groupBy } }) }));
vi.mock("@/modules/events/events-admin-home-repository", () => ({ getEventsAdminEventSources: mocks.getEventsAdminEventSources }));

import EventsAdminPage from "@/app/(workspace)/events-admin/page";
import {
  WORK_NOT_ADDED_NOTE,
  acrossYourEventsLabel,
  buildEventsAdminHome,
  eventsAdminTabs,
  type EventsAdminEventSource,
} from "@/modules/events/events-admin-home-model";
import { adminRoleLanding } from "@/modules/access/admin-roles-domain";

const now = new Date("2026-10-26T18:00:00.000Z");

function source(overrides: Partial<EventsAdminEventSource> = {}): EventsAdminEventSource {
  return {
    id: "event-one",
    slug: "event-one",
    name: "Synthetic Family Retreat",
    startsAt: new Date("2026-11-20T15:00:00.000Z"),
    endsAt: new Date("2026-11-22T15:00:00.000Z"),
    timezone: "America/Chicago",
    location: "Synthetic Camp",
    capacity: 100,
    isPublished: true,
    archivedAt: null,
    registrationOpensOn: "2026-01-01",
    registrationClosesOn: "2026-11-15",
    waitlistEnabled: true,
    registrations: [],
    attendeeCount: 0,
    checkedInCount: 0,
    activeStaffCount: 1,
    publishedFormCount: 1,
    waitingCount: 0,
    importIssueCount: 0,
    importWarningCount: 0,
    deliveryIssueCount: 0,
    billingMode: "ATTENDEE_PAY",
    draftRegistrationCount: 0,
    failedEmailCount: 0,
    ...overrides,
  };
}

const owes = (total: number, paid = 0) => ({
  status: "CONFIRMED",
  totalAmountCents: total,
  payments: paid > 0 ? [{ amountCents: paid, refunds: [] }] : [],
});

describe("the dashboard model", () => {
  it("counts only assigned, upcoming events and never archived or ended ones", () => {
    const home = buildEventsAdminHome([
      source({ id: "a", name: "Synthetic A", attendeeCount: 10, registrations: [owes(5000), owes(5000, 5000)] }),
      source({ id: "ended", name: "Synthetic Ended", startsAt: new Date("2026-03-01T00:00:00Z"), endsAt: new Date("2026-03-03T00:00:00Z"), attendeeCount: 99, registrations: [owes(9000)] }),
      source({ id: "archived", name: "Synthetic Archived", archivedAt: new Date("2026-09-01T00:00:00Z"), attendeeCount: 77, registrations: [owes(9000)] }),
    ], now);
    expect(home.events.map((event) => event.id)).toEqual(["a"]);
    expect(home.counts).toMatchObject({ assignedEvents: 1, activeRegistrations: 2, expectedAttendees: 10, needAttention: 1 });
  });

  it("counts a registration that owes money or is a draft once, and keeps the work rows separate", () => {
    const home = buildEventsAdminHome([
      source({ id: "a", name: "Synthetic A", registrations: [owes(5000), owes(5000, 2000), owes(5000, 5000)], draftRegistrationCount: 2, failedEmailCount: 4 }),
      source({ id: "b", name: "Synthetic B", startsAt: new Date("2026-12-05T15:00:00Z"), endsAt: new Date("2026-12-06T15:00:00Z"), registrations: [owes(100)], draftRegistrationCount: 1 }),
    ], now);
    expect(home.counts.needAttention).toBe(2 + 2 + 1 + 1);
    expect(Object.fromEntries(home.workRows.map((row) => [row.kind, row.total]))).toEqual({ "open-balances": 3, "incomplete-forms": 3, messages: 4 });
    // Not one combined number: needAttention is balances plus drafts only, and messages are a separate row.
    expect(home.workRows.map((row) => row.kind)).toEqual(["open-balances", "incomplete-forms", "messages"]);
    const messages = home.workRows.find((row) => row.kind === "messages")!;
    expect(messages.items.map((item) => [item.eventId, item.count, item.href])).toEqual([
      ["a", 4, "/communications?view=deliveries&event=a"],
      ["b", 0, "/communications?view=deliveries&event=b"],
    ]);
    expect(home.workRows[0].items[0].href).toBe("/finance?filter=BALANCE&event=a");
    expect(home.workRows[1].items[0].href).toBe("/people?filter=DRAFT&event=a");
    expect(WORK_NOT_ADDED_NOTE).toBe("These are not added together: one person can appear in more than one row.");
  });

  it("counts no balances on an event billed to churches after the event", () => {
    const home = buildEventsAdminHome([source({ billingMode: "DEFERRED_ORGANIZATION_INVOICE", registrations: [owes(5000)], draftRegistrationCount: 1 })], now);
    expect(home.events[0].openBalanceCount).toBe(0);
    expect(home.events[0].billedToChurches).toBe(true);
    expect(home.counts.needAttention).toBe(1);
    expect(home.workRows[0].items[0].note).toContain("Billed to churches");
  });

  it("words registered against capacity, with and without one", () => {
    const home = buildEventsAdminHome([
      source({ id: "a", attendeeCount: 40, capacity: 100 }),
      source({ id: "b", startsAt: new Date("2026-12-05T15:00:00Z"), endsAt: new Date("2026-12-06T15:00:00Z"), attendeeCount: 7, capacity: null }),
    ], now);
    expect(home.events.map((event) => event.registeredText)).toEqual(["Registered 40 of 100", "7 registered, no capacity set"]);
  });

  it("takes each status from the shared #1201 helper: open dates with no form read Opens soon", () => {
    const open = (overrides: Partial<EventsAdminEventSource>) => buildEventsAdminHome([source({ registrationOpensOn: "2026-01-01", registrationClosesOn: "2026-11-15", ...overrides })], now).events[0].statusLabel;
    expect(open({ publishedFormCount: 1 })).toBe("Registration open");
    expect(open({ publishedFormCount: 0 })).toBe("Opens soon");
    expect(open({ registrationOpensOn: "2026-11-01", publishedFormCount: 1 })).toBe("Opens soon");
    expect(open({ isPublished: false })).toBe("Draft");
    expect(open({ registrationClosesOn: "2026-10-01" })).toBe("Registration closed");
  });

  it("picks the soonest event that has not ended as next, with an event in progress first", () => {
    const upcoming = buildEventsAdminHome([
      source({ id: "later", startsAt: new Date("2026-12-05T15:00:00Z"), endsAt: new Date("2026-12-06T15:00:00Z") }),
      source({ id: "sooner" }),
    ], now);
    expect(upcoming.next).toMatchObject({ id: "sooner", happeningNow: false, daysUntilStart: 25 });
    const running = buildEventsAdminHome([source({ id: "sooner" }), source({ id: "running", startsAt: new Date("2026-10-25T15:00:00Z"), endsAt: new Date("2026-10-27T15:00:00Z") })], now);
    expect(running.next).toMatchObject({ id: "running", happeningNow: true, daysUntilStart: null });
    expect(buildEventsAdminHome([], now)).toMatchObject({ events: [], next: null, counts: { assignedEvents: 0, needAttention: 0 } });
  });

  it("builds the tabs, hiding the event tabs when there is no next event", () => {
    expect(eventsAdminTabs(null).map((tab) => tab.label)).toEqual(["Overview", "My events"]);
    const tabs = eventsAdminTabs("event one");
    expect(tabs.map((tab) => [tab.label, tab.href])).toEqual([
      ["Overview", "/events-admin"],
      ["My events", "#your-events"],
      ["Registrations", "/people?event=event%20one"],
      ["Schedule", "/more/event-content?event=event%20one"],
      ["Kitchen reports", "/more/kitchen-report?event=event%20one"],
      ["Messages", "/communications?event=event%20one"],
    ]);
  });

  it("says the real number of events, not both", () => {
    expect(acrossYourEventsLabel(2)).toBe("Across your 2 events");
    expect(acrossYourEventsLabel(3)).toBe("Across your 3 events");
    expect(acrossYourEventsLabel(1)).toBe("Across your 1 event");
  });

  it("lands an Events Administrator here", () => {
    expect(adminRoleLanding("EVENTS_ADMIN")).toBe("/events-admin");
  });
});

describe("the read's scope", () => {
  let getEventsAdminEventSources: (ids: readonly string[], at: Date) => Promise<EventsAdminEventSource[]>;

  beforeAll(async () => {
    ({ getEventsAdminEventSources } = await vi.importActual<typeof import("@/modules/events/events-admin-home-repository")>("@/modules/events/events-admin-home-repository"));
  }, 30_000);

  beforeEach(() => {
    mocks.eventFindMany.mockReset();
    mocks.groupBy.mockReset();
    mocks.groupBy.mockResolvedValue([]);
  });

  it("asks only for the given event ids, never archived, never ended, from the shared select", async () => {
    mocks.eventFindMany.mockResolvedValue([]);
    await getEventsAdminEventSources(["event-a", "event-b"], now);
    expect(mocks.eventFindMany).toHaveBeenCalledTimes(1);
    const args = mocks.eventFindMany.mock.calls[0]![0];
    expect(args.where).toEqual({ archivedAt: null, id: { in: ["event-a", "event-b"] }, endsAt: { gte: now } });
    expect(args.select.registrations).toBeDefined();
  });

  it("runs no query and returns no events for an empty id list", async () => {
    await expect(getEventsAdminEventSources([], now)).resolves.toEqual([]);
    expect(mocks.eventFindMany).not.toHaveBeenCalled();
    expect(mocks.groupBy).not.toHaveBeenCalled();
  });

  const row = {
    id: "event-a", slug: "a", name: "Synthetic A", startsAt: new Date("2026-11-20T15:00:00Z"), endsAt: new Date("2026-11-22T15:00:00Z"), timezone: "America/Chicago",
    location: null, capacity: null, isPublished: true, archivedAt: null, registrationOpensOn: null, registrationClosesOn: null, waitlistEnabled: false,
    registrations: [], attendees: [], checkIns: [], memberships: [], registrationForms: [], waitlistEntries: [], importRuns: [], messageOutbox: [],
  };

  it("reads the extras and failed messages only for the events the first read returned", async () => {
    mocks.eventFindMany.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ id: "event-a", billingMode: "ATTENDEE_PAY", _count: { registrations: 3 } }]);
    mocks.groupBy.mockResolvedValueOnce([{ eventId: "event-a", _count: { _all: 2 } }]).mockResolvedValueOnce([{ eventId: "event-a", _count: { _all: 1 } }]);
    const result = await getEventsAdminEventSources(["event-a", "event-b"], now);
    expect(mocks.eventFindMany.mock.calls[1]![0].where).toEqual({ id: { in: ["event-a"] }, archivedAt: null });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "event-a", draftRegistrationCount: 3, failedEmailCount: 3, billingMode: "ATTENDEE_PAY" });
  });

  it("counts failed messages by the System rule: last 7 days, not later resent, only the assigned ids", async () => {
    mocks.eventFindMany.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    await getEventsAdminEventSources(["event-a", "event-b"], now);
    expect(mocks.groupBy).toHaveBeenCalledTimes(2);
    const since = new Date("2026-10-19T18:00:00.000Z");
    const [failed, provider] = mocks.groupBy.mock.calls.map((call) => call[0].where);
    // Only the returned (assigned) event: another event's failure is never in the where.
    expect(failed).toEqual({ status: "FAILED", failedAt: { gte: since }, retries: { none: { status: "SENT" } }, eventId: { in: ["event-a"] } });
    expect(provider).toMatchObject({ providerStatusAt: { gte: since }, retries: { none: { status: "SENT" } }, eventId: { in: ["event-a"] } });
    // An 8-day-old failure (before `since`) and a recovered one (a retry was SENT) fall outside these filters.
    expect(new Date(now.getTime() - 8 * 86_400_000).getTime()).toBeLessThan(since.getTime());
  });
});

describe("the page", () => {
  const person = { id: "user-1", displayName: "Synthetic Organizer", email: "organizer@imsda-events.test", globalRole: null };
  const render = async () => renderToStaticMarkup(await EventsAdminPage());

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    mocks.getCurrentSession.mockResolvedValue({ user: person });
    mocks.resolveAdminRoles.mockResolvedValue({ systemAdmin: false, clubsAdministrator: false, eventAdminEventIds: ["event-one", "event-two"] });
    mocks.getEventsAdminEventSources.mockResolvedValue([
      source({ attendeeCount: 40, capacity: 100, registrations: [owes(5000), owes(5000, 5000)], draftRegistrationCount: 2, failedEmailCount: 1 }),
      source({ id: "event-two", name: "Synthetic Camporee", startsAt: new Date("2026-12-05T15:00:00Z"), endsAt: new Date("2026-12-06T15:00:00Z"), capacity: null, attendeeCount: 12, publishedFormCount: 0 }),
    ]);
  });

  it("sends a signed-out visitor to sign in and a person with no EVENT_ADMIN membership to no-access, reading nothing", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    await expect(render()).rejects.toThrow("redirect:/login");
    mocks.getCurrentSession.mockResolvedValue({ user: person });
    mocks.resolveAdminRoles.mockResolvedValue({ systemAdmin: false, clubsAdministrator: true, eventAdminEventIds: [] });
    await expect(render()).rejects.toThrow("redirect:/no-access");
    // A system administrator with no EVENT_ADMIN membership does not qualify either.
    mocks.resolveAdminRoles.mockResolvedValue({ systemAdmin: true, clubsAdministrator: false, eventAdminEventIds: [] });
    await expect(render()).rejects.toThrow("redirect:/no-access");
    expect(mocks.getEventsAdminEventSources).not.toHaveBeenCalled();
  });

  it("reads exactly the ids resolved from the person's memberships", async () => {
    await render();
    expect(mocks.resolveAdminRoles).toHaveBeenCalledWith(person);
    expect(mocks.getEventsAdminEventSources).toHaveBeenCalledWith(["event-one", "event-two"], expect.any(Date));
  });

  it("takes no query string at all, so no event id can be passed in", () => {
    expect(EventsAdminPage.length).toBe(0);
    const text = readFileSync(join(process.cwd(), "app/(workspace)/events-admin/page.tsx"), "utf8");
    expect(text).not.toMatch(/searchParams/);
  });

  it("shows the tabs, header, four cards, the summary line, the event cards and the work rows", async () => {
    const html = await render();
    expect(html).toContain('aria-label="Event administration sections"');
    expect(html).toMatch(/<a aria-current="page" href="\/events-admin">Overview</);
    for (const href of ["#your-events", "/people?event=event-one", "/more/event-content?event=event-one", "/more/kitchen-report?event=event-one", "/communications?event=event-one"]) expect(html).toContain(`href="${href}"`);
    expect(html).toContain("Event administration");
    expect(html).toContain("Your role: Events Administrator. Runs only the events where they are an Event administrator; club records and club events are not part of it.");
    expect(html).toContain("Upcoming events you administer. Archived events are not counted.");
    expect(html).toContain("Across your 2 events");
    expect(html).toContain("Open balances and incomplete forms, across your events");
    expect(html).toMatch(/data-card="assigned-events"[^]*?<strong>2<\/strong>/);
    expect(html).toMatch(/data-card="need-attention"[^]*?<strong>3<\/strong>/);
    expect(html).toMatch(/data-card="next-event"[^]*?<strong>25<\/strong>/);
    expect(html).toContain("<strong>52</strong> expected attendees");
    expect(html).toContain("Synthetic Family Retreat: <strong>40</strong> registered");
    expect(html).toContain('id="your-events"');
    expect(html).toContain("Registered 40 of 100");
    expect(html).toContain("12 registered, no capacity set");
    expect(html).toContain("Kitchen report");
    expect(html).toContain('href="/overview?event=event-one"');
    expect(html).toContain("Work waiting for you");
    expect(html).toContain(WORK_NOT_ADDED_NOTE);
    expect(html).toContain('href="/communications?view=deliveries&amp;event=event-one"');
    expect(html).toContain('href="/finance?filter=BALANCE&amp;event=event-one"');
    expect(html).toContain('href="/people?filter=DRAFT&amp;event=event-one"');
  });

  it("shows an open event with no published form as Opens soon", async () => {
    const html = await render();
    const second = html.slice(html.indexOf('data-event-id="event-two"'));
    expect(second).toContain("Opens soon");
    expect(second).not.toContain("Registration open");
    expect(html.slice(html.indexOf('data-event-id="event-one"'), html.indexOf('data-event-id="event-two"'))).toContain("Registration open");
  });

  it("names Happening now for an event in progress", async () => {
    mocks.getEventsAdminEventSources.mockResolvedValue([source({ startsAt: new Date("2026-10-25T15:00:00Z"), endsAt: new Date("2026-10-27T15:00:00Z") })]);
    const html = await render();
    expect(html).toMatch(/data-card="next-event"[^]*?<strong>Happening now<\/strong>/);
    expect(html).toContain("Across your 1 event");
  });

  it("shows an empty state, no event tabs and no counts of other events when nothing is upcoming", async () => {
    mocks.getEventsAdminEventSources.mockResolvedValue([]);
    const html = await render();
    expect(html).toContain('data-testid="events-admin-empty"');
    expect(html).toContain("No upcoming events assigned to you");
    expect(html).not.toContain("/people?event=");
    expect(html).toMatch(/data-card="assigned-events"[^]*?<strong>0<\/strong>/);
    expect(html).toMatch(/data-card="next-event"[^]*?<strong>None<\/strong>/);
  });

  it("only reads and links: no form, no write", () => {
    const text = readFileSync(join(process.cwd(), "app/(workspace)/events-admin/page.tsx"), "utf8");
    expect(text).not.toMatch(/<form|method="post"|fetch\(|"use server"|<button/i);
  });
});

describe("layout rules", () => {
  const css = readFileSync(join(process.cwd(), "app/(workspace)/events-admin/events-admin.module.css"), "utf8");
  const tabsCss = readFileSync(join(process.cwd(), "components/dashboard-tabs.module.css"), "utf8");

  it("keeps staff text at the 14px floor and every link at 44px, and lets the tabs wrap", () => {
    expect(css).not.toMatch(/font-size:\s*0\.[0-7]\d*rem/);
    expect(css).toMatch(/\.rowLink \{[^}]*min-height: 44px;/);
    expect(css).toMatch(/\.cards small a \{[^}]*min-height: 44px;/);
    expect(tabsCss).toMatch(/\.tabs a \{[^}]*min-height: 44px;/);
    expect(tabsCss).toMatch(/flex-wrap: wrap;/);
    expect(tabsCss).not.toMatch(/overflow-x: scroll/);
  });
});
