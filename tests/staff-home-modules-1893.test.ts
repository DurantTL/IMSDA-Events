import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminRoles } from "@/modules/access/admin-roles-domain";
import type { EventPermission } from "@/modules/access/permissions";
import { rolePermissions } from "@/modules/access/permissions";
import { HOME_MODULES, resolveHomeLayout, type HomeModuleKey } from "@/modules/system-admin/home-layout-domain";
import {
  CLUB_APPLICATIONS_MAX,
  MONEY_EVENTS_MAX,
  buildClubApplications,
  buildLiveCheckIn,
  buildMoneyThisSeason,
  isCheckInOpen,
  lastArrivalText,
  moneyFigures,
  waitedText,
  type LiveCheckInSource,
  type MoneyEventSource,
} from "@/modules/system-admin/home-extra-modules-model";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/logger", async (original) => ({ ...(await original<typeof import("@/lib/logger")>()), logError: vi.fn() }));

// Thursday, Nov 12, 2026, 9 AM in Iowa and Missouri: the 2026-2027 club year.
const now = new Date("2026-11-12T15:00:00Z");
const none: AdminRoles = { systemAdmin: false, clubsAdministrator: false, eventAdminEventIds: [] };
const system: AdminRoles = { ...none, systemAdmin: true };
const clubs: AdminRoles = { ...none, clubsAdministrator: true };
const events: AdminRoles = { ...none, eventAdminEventIds: ["evt_camporee"] };
const eventsAndClubs: AdminRoles = { ...none, clubsAdministrator: true, eventAdminEventIds: ["evt_camporee"] };

// --- A fake database: synthetic events, money and check-ins, recording which events each read asked for. ---

type FakeEvent = { id: string; name: string; startsAt: Date; endsAt: Date; timezone: string; archivedAt: Date | null; billingMode: string };
const tz = "America/Chicago";
const fakeEvents: FakeEvent[] = [
  // Check-in open today, in this season.
  { id: "evt_camporee", name: "Fall Camporee", startsAt: new Date("2026-11-12T14:00:00Z"), endsAt: new Date("2026-11-14T20:00:00Z"), timezone: tz, archivedAt: null, billingMode: "PAY_AT_REGISTRATION" },
  // In this season, not open (January).
  { id: "evt_retreat", name: "Winter Retreat", startsAt: new Date("2027-01-15T18:00:00Z"), endsAt: new Date("2027-01-17T18:00:00Z"), timezone: tz, archivedAt: null, billingMode: "PAY_AT_REGISTRATION" },
  // Open today too, but only a system administrator may see it here.
  { id: "evt_music", name: "Music Fest", startsAt: new Date("2026-11-11T14:00:00Z"), endsAt: new Date("2026-11-13T20:00:00Z"), timezone: tz, archivedAt: null, billingMode: "DEFERRED_ORGANIZATION_INVOICE" },
  // Last season: never in Money this season.
  { id: "evt_spring", name: "Spring Camporee", startsAt: new Date("2026-04-20T14:00:00Z"), endsAt: new Date("2026-04-22T20:00:00Z"), timezone: tz, archivedAt: null, billingMode: "PAY_AT_REGISTRATION" },
];

const asked: Record<string, string[][]> = {};
const ask = (table: string, where: { eventId?: { in?: string[] } }) => { (asked[table] ??= []).push([...(where.eventId?.in ?? [])].sort()); };
let failMoney = false;

type Range = { gte?: Date; lt?: Date; lte?: Date };
const inRange = (value: Date, range?: Range) => !range
  || ((range.gte === undefined || value >= range.gte) && (range.lt === undefined || value < range.lt) && (range.lte === undefined || value <= range.lte));

const db = {
  event: {
    findMany: async ({ where }: { where: { archivedAt: null; startsAt?: Range; endsAt?: Range } }) =>
      fakeEvents.filter((event) => event.archivedAt === null && inRange(event.startsAt, where.startsAt) && inRange(event.endsAt, where.endsAt)),
  },
  payment: {
    findMany: async ({ where }: { where: { eventId: { in: string[] } } }) => {
      ask("payment", where);
      if (failMoney) throw new Error("database is down");
      return [
        { eventId: "evt_camporee", amount: 120, refunds: [{ amount: 20 }] },
        { eventId: "evt_retreat", amount: 50.5, refunds: [] },
        { eventId: "evt_music", amount: 999, refunds: [] },
      ].filter((row) => where.eventId.in.includes(row.eventId));
    },
  },
  registration: {
    findMany: async ({ where }: { where: { eventId: { in: string[] } } }) => {
      ask("registration", where);
      return [
        { eventId: "evt_camporee", totalAmount: 150, payments: [{ amount: 120, refunds: [{ amount: 20 }] }] },
        { eventId: "evt_retreat", totalAmount: 75, payments: [{ amount: 50.5, refunds: [] }] },
        { eventId: "evt_music", totalAmount: 400, payments: [] },
      ].filter((row) => where.eventId.in.includes(row.eventId));
    },
  },
  cancellationRequest: {
    groupBy: async ({ where }: { where: { eventId: { in: string[] }; status: unknown } }) => {
      ask("cancellationRequest", where);
      // Two open requests asking $40 back, and one approved that nobody has carried out ($25).
      const rows = where.status === "APPROVED"
        ? [{ eventId: "evt_camporee", _count: { _all: 1 }, _sum: { proposedRefundCents: 2500 } }]
        : [{ eventId: "evt_camporee", _count: { _all: 2 }, _sum: { proposedRefundCents: 4000 } }];
      return rows.filter((row) => where.eventId.in.includes(row.eventId));
    },
  },
  cancellationExecution: {
    findMany: async ({ where }: { where: { eventId: { in: string[] } } }) => {
      ask("cancellationExecution", where);
      // Being carried out: $30 approved, $10 back so far.
      return [{ eventId: "evt_camporee", status: "PROCESSOR_PENDING", approvedRefundCents: 3000, refunds: [{ amountCents: 1000, status: "DONE", resolvedAt: null }, { amountCents: 2000, status: "PENDING", resolvedAt: null }] }]
        .filter((row) => where.eventId.in.includes(row.eventId));
    },
  },
  cancellationExecutionRefund: {
    findMany: async ({ where }: { where: { eventId: { in: string[] } } }) => {
      ask("cancellationExecutionRefund", where);
      return [{ refundId: "ref_cancel" }];
    },
  },
  refund: {
    findMany: async ({ where }: { where: { eventId: { in: string[] } } }) => {
      ask("refund", where);
      // One manual refund with the processor ($15), and the cancellation's own one, already counted above.
      return [{ id: "ref_manual", eventId: "evt_camporee", amount: 15 }, { id: "ref_cancel", eventId: "evt_camporee", amount: 20 }].filter((row) => where.eventId.in.includes(row.eventId));
    },
  },
  invoice: {
    findMany: async ({ where }: { where: { eventId: string } }) => {
      (asked.invoice ??= []).push([where.eventId]);
      return [];
    },
  },
  registrationAttendee: {
    groupBy: async ({ where }: { where: { eventId: { in: string[] } } }) => {
      ask("registrationAttendee", where);
      return [{ eventId: "evt_camporee", _count: { _all: 80 } }, { eventId: "evt_music", _count: { _all: 30 } }].filter((row) => where.eventId.in.includes(row.eventId));
    },
  },
  checkIn: {
    groupBy: async ({ where }: { where: { eventId: { in: string[] } } }) => {
      ask("checkIn", where);
      return [{ eventId: "evt_camporee", _count: { _all: 20 }, _max: { checkedInAt: new Date("2026-11-12T14:41:00Z") } }].filter((row) => where.eventId.in.includes(row.eventId));
    },
  },
  clubEventRegistration: {
    groupBy: async ({ where }: { where: { eventId: { in: string[] }; registration: { attendees?: unknown } } }) => {
      ask("clubEventRegistration", where);
      const rows = where.registration.attendees ? [{ eventId: "evt_camporee", _count: { _all: 3 } }] : [{ eventId: "evt_camporee", _count: { _all: 12 } }];
      return rows.filter((row) => where.eventId.in.includes(row.eventId));
    },
  },
  newClubApplication: {
    count: async () => 7,
    findMany: async (args: { select: Record<string, boolean> }) => {
      (asked.newClubApplicationSelect ??= []).push(Object.keys(args.select).sort());
      return [
        { id: "app_1", clubName: "Cedar Rapids Pathfinders", clubType: "PATHFINDER", createdAt: new Date("2026-11-02T15:00:00Z") },
        { id: "app_2", clubName: "Joplin Adventurers", clubType: "ADVENTURER", createdAt: new Date("2026-11-12T13:00:00Z") },
      ];
    },
  },
};
vi.mock("@/lib/prisma", () => ({ getPrisma: () => db }));

// Event permissions as the membership read gives them, per person (the same read the event pages use).
const permissions = new Map<string, Map<string, EventPermission[]>>();
vi.mock("@/modules/access/membership-repository", () => ({
  listActiveEventPermissionsForUser: async (userId: string, eventIds: readonly string[]) =>
    new Map([...(permissions.get(userId) ?? new Map<string, EventPermission[]>())].filter(([eventId]) => eventIds.includes(eventId))),
}));
const eventAdmin = [...rolePermissions.EVENT_ADMIN];
permissions.set("user_events", new Map([["evt_camporee", eventAdmin]]));
// A Clubs Administrator holds EVENT_ADMIN on club events (#1643): the Camporee and the Retreat here.
permissions.set("user_clubs", new Map([["evt_camporee", eventAdmin], ["evt_retreat", eventAdmin]]));
permissions.set("user_two", new Map([["evt_camporee", eventAdmin], ["evt_retreat", eventAdmin]]));
// A check-in volunteer: no Payments.
permissions.set("user_desk", new Map([["evt_camporee", ["VIEW_EVENT", "MANAGE_CHECK_IN"] as EventPermission[]]]));
// Finance only: no check-in desk.
permissions.set("user_finance", new Map([["evt_camporee", ["VIEW_EVENT", "MANAGE_FINANCE"] as EventPermission[]]]));

const { loadHomeExtraModules } = await import("@/modules/system-admin/home-extra-modules-repository");
const all = new Set<HomeModuleKey>(["club-applications", "money-this-season", "live-check-in"]);

beforeEach(() => {
  for (const key of Object.keys(asked)) delete asked[key];
  failMoney = false;
});

describe("Who may turn these modules on (#1893)", () => {
  const usable = (roles: AdminRoles) => HOME_MODULES.filter((module) => module.mayUse(roles)).map((module) => module.key);

  it("offers Club applications to System and Clubs admins only", () => {
    expect(usable(system)).toContain("club-applications");
    expect(usable(clubs)).toContain("club-applications");
    expect(usable(eventsAndClubs)).toContain("club-applications");
    expect(usable(events)).not.toContain("club-applications");
    expect(usable(none)).toEqual([]);
  });

  it("offers Money and Live check-in to admins who can hold event permissions, and to no one else", () => {
    for (const roles of [system, clubs, events, eventsAndClubs]) {
      expect(usable(roles)).toEqual(expect.arrayContaining(["money-this-season", "live-check-in"]));
    }
    expect(usable(none)).not.toContain("money-this-season");
  });

  it("puts Live check-in first for System and Events admins, Club applications after Monthly Records for Clubs admins, and Money in no default", () => {
    const on = (roles: AdminRoles) => resolveHomeLayout(null, roles).modules.filter((module) => module.shown).map((module) => module.key);
    expect(on(system)[0]).toBe("live-check-in");
    expect(on(events)[0]).toBe("live-check-in");
    expect(on(clubs)).toEqual(["needs-you", "monthly-records", "club-applications", "season-numbers"]);
    for (const roles of [system, clubs, events, eventsAndClubs]) expect(on(roles)).not.toContain("money-this-season");
  });

  it("says in Customize what Money and Live check-in show", () => {
    const modules = resolveHomeLayout(null, events).modules;
    expect(modules.find((module) => module.key === "live-check-in")?.note).toMatch(/only while check-in is open/i);
    expect(modules.find((module) => module.key === "money-this-season")?.note).toMatch(/payments/i);
  });

  it("adds the new modules hidden to a layout someone already customized", () => {
    const layout = resolveHomeLayout([{ key: "needs-you", shown: true }, { key: "season-numbers", shown: true }], system);
    expect(layout.modules.filter((module) => ["club-applications", "money-this-season", "live-check-in"].includes(module.key)).every((module) => !module.shown)).toBe(true);
  });
});

describe("Home reads per role (#1893)", () => {
  it("System admin: every event's money and open check-in, and the applications", async () => {
    const data = await loadHomeExtraModules("user_system", system, all, now);
    expect(data["club-applications"]?.waitingCount).toBe(7);
    expect(data["money-this-season"]?.rows.map((row) => row.id)).toEqual(["evt_music", "evt_camporee", "evt_retreat"]);
    expect(data["live-check-in"]?.rows.map((row) => row.id)).toEqual(["evt_music", "evt_camporee"]);
    expect(asked.payment).toEqual([["evt_camporee", "evt_music", "evt_retreat"]]);
    // Church invoices are read only for the event billed to churches.
    expect(asked.invoice).toEqual([["evt_music"]]);
  });

  it("Clubs admin: the applications, and money and check-in only for club events", async () => {
    const data = await loadHomeExtraModules("user_clubs", clubs, all, now);
    expect(data["club-applications"]?.rows).toHaveLength(2);
    expect(data["money-this-season"]?.rows.map((row) => row.id)).toEqual(["evt_camporee", "evt_retreat"]);
    expect(data["live-check-in"]?.rows.map((row) => row.id)).toEqual(["evt_camporee"]);
    expect(asked.payment).toEqual([["evt_camporee", "evt_retreat"]]);
  });

  it("Events admin for one event: no applications, and only that event's numbers", async () => {
    const data = await loadHomeExtraModules("user_events", events, all, now);
    expect(data["club-applications"]).toBeUndefined();
    expect(data["money-this-season"]?.rows.map((row) => row.id)).toEqual(["evt_camporee"]);
    // $40 asked for, $25 approved, $20 still with the processor on one being carried out, $15 manual: 5 waiting, $100.
    expect(data["money-this-season"]?.rows[0]).toMatchObject({ collectedCents: 10000, owedCents: 5000, refundsWaiting: { count: 5, cents: 10000 } });
    expect(data["live-check-in"]?.rows.map((row) => row.id)).toEqual(["evt_camporee"]);
    for (const table of ["payment", "registration", "cancellationRequest", "cancellationExecution", "cancellationExecutionRefund", "refund", "registrationAttendee", "checkIn", "clubEventRegistration"]) {
      expect(asked[table]?.flat().every((id) => id === "evt_camporee"), table).toBe(true);
    }
  });

  it("Two roles: Events and Clubs admin get the applications and each event they hold permissions for, once", async () => {
    const data = await loadHomeExtraModules("user_two", eventsAndClubs, all, now);
    expect(data["club-applications"]?.waitingCount).toBe(7);
    expect(data["money-this-season"]?.rows.map((row) => row.id)).toEqual(["evt_camporee", "evt_retreat"]);
    expect(data["live-check-in"]?.rows.map((row) => row.id)).toEqual(["evt_camporee"]);
  });

  it("No admin role: nothing is read, even when asked", async () => {
    expect(await loadHomeExtraModules("user_events", none, all, now)).toEqual({});
    expect(asked).toEqual({});
  });

  it("reads nothing for a module that is turned off", async () => {
    expect(await loadHomeExtraModules("user_system", system, new Set(), now)).toEqual({});
    expect(asked).toEqual({});
  });

  it("leaves out events where the person cannot open Payments or the check-in desk", async () => {
    const desk = await loadHomeExtraModules("user_desk", events, all, now);
    expect(desk["money-this-season"]?.totals.eventCount).toBe(0);
    expect(asked.payment).toBeUndefined();
    expect(desk["live-check-in"]?.rows.map((row) => row.id)).toEqual(["evt_camporee"]);
    const finance = await loadHomeExtraModules("user_finance", events, all, now);
    expect(finance["money-this-season"]?.rows.map((row) => row.id)).toEqual(["evt_camporee"]);
    expect(finance["live-check-in"]?.rows).toEqual([]);
  });

  it("reads only each application's name, kind and date, never a director or contact", async () => {
    await loadHomeExtraModules("user_clubs", clubs, new Set(["club-applications"]), now);
    expect(asked.newClubApplicationSelect).toEqual([["clubName", "clubType", "createdAt", "id"]]);
  });

  it("shows Unavailable, not zero, when a read fails, and the other modules still load", async () => {
    failMoney = true;
    const data = await loadHomeExtraModules("user_system", system, all, now);
    expect(data["money-this-season"]).toBeNull();
    expect(data["live-check-in"]?.rows.length).toBe(2);
    const { MoneyThisSeasonModule } = await import("@/components/home-modules");
    const html = renderToStaticMarkup(createElement(MoneyThisSeasonModule, { view: null }));
    expect(html).toMatch(/unavailable/i);
    expect(html).not.toContain("$0.00");
  });
});

describe("Club applications model (#1893)", () => {
  it("counts days waited", () => {
    expect(waitedText(new Date("2026-11-12T09:00:00Z"), now)).toBe("Waiting since today");
    expect(waitedText(new Date("2026-11-11T14:00:00Z"), now)).toBe("Waiting 1 day");
    expect(waitedText(new Date("2026-11-02T15:00:00Z"), now)).toBe("Waiting 10 days");
  });

  it("lists the oldest first, at most five, each linking to its application in the queue", () => {
    const rows = Array.from({ length: 7 }, (_, at) => ({ id: `app_${at}`, clubName: `Club ${at}`, clubType: "PATHFINDER", submittedAt: new Date(Date.UTC(2026, 10, 1 + at)) }));
    const view = buildClubApplications(7, rows, now);
    expect(view.rows).toHaveLength(CLUB_APPLICATIONS_MAX);
    expect(view.rows[0]).toMatchObject({ clubName: "Club 0", clubTypeLabel: "Pathfinder club", href: "/admin/clubs/applications?application=app_0" });
    expect(view.href).toBe("/admin/clubs/applications");
  });

  it("renders a link to the queue, and says when nothing is waiting", async () => {
    const { ClubApplicationsModule } = await import("@/components/home-modules");
    const full = renderToStaticMarkup(createElement(ClubApplicationsModule, { view: buildClubApplications(1, [{ id: "app_1", clubName: "Cedar Rapids Pathfinders", clubType: "PATHFINDER", submittedAt: new Date("2026-11-02T15:00:00Z") }], now) }));
    expect(full).toContain('href="/admin/clubs/applications?application=app_1"');
    expect(full).toContain("Waiting 10 days");
    const empty = renderToStaticMarkup(createElement(ClubApplicationsModule, { view: buildClubApplications(0, [], now) }));
    expect(empty).toContain('data-testid="home-club-applications-empty"');
    expect(empty).toContain('href="/admin/clubs/applications"');
  });
});

describe("Money this season model (#1893)", () => {
  function money(patch: Partial<MoneyEventSource> & { id: string }): MoneyEventSource {
    return {
      name: `Event ${patch.id}`, startsAt: new Date("2026-12-01T15:00:00Z"), endsAt: new Date("2026-12-03T15:00:00Z"), churchBilled: false,
      payments: [], activeRegistrations: [], churchInvoices: null,
      cancellationRefunds: { undecidedOrNotStarted: { count: 0, cents: 0 }, executions: [] }, pendingRefunds: { count: 0, cents: 0 }, ...patch,
    };
  }

  it("collects payments less refunds, owes the dashboards' balance, and adds up refunds waiting", () => {
    const figures = moneyFigures(money({
      id: "a",
      payments: [{ amountCents: 12000, refundedCents: 2000 }],
      activeRegistrations: [
        { totalAmountCents: 15000, payments: [{ amountCents: 12000, refunds: [{ amountCents: 2000 }] }] },
        // Overpaid: never a negative balance.
        { totalAmountCents: 1000, payments: [{ amountCents: 3000, refunds: [] }] },
      ],
      cancellationRefunds: { undecidedOrNotStarted: { count: 2, cents: 4000 }, executions: [] },
      pendingRefunds: { count: 1, cents: 1500 },
    }));
    expect(figures).toEqual({ collectedCents: 10000, owedCents: 5000, refundsWaiting: { count: 3, cents: 5500 } });
  });

  it("counts a cancellation's refund until it is paid back, and a failed one until someone settles it", () => {
    const refunds = (executions: MoneyEventSource["cancellationRefunds"]["executions"]) => moneyFigures(money({ id: "a", cancellationRefunds: { undecidedOrNotStarted: { count: 0, cents: 0 }, executions } })).refundsWaiting;
    // Under way: $50 approved, $20 back.
    expect(refunds([{ completed: false, approvedRefundCents: 5000, legs: [{ amountCents: 2000, status: "DONE", resolved: false }] }])).toEqual({ count: 1, cents: 3000 });
    // Not started yet: the whole amount.
    expect(refunds([{ completed: false, approvedRefundCents: 5000, legs: [] }])).toEqual({ count: 1, cents: 5000 });
    // Carried out, but one refund failed and nobody settled it.
    expect(refunds([{ completed: true, approvedRefundCents: 5000, legs: [{ amountCents: 3000, status: "DONE", resolved: false }, { amountCents: 2000, status: "FAILED", resolved: false }] }])).toEqual({ count: 1, cents: 2000 });
    // Carried out offline (no refund lines), or a failed refund settled outside the app: nothing waits.
    expect(refunds([{ completed: true, approvedRefundCents: 5000, legs: [] }])).toEqual({ count: 0, cents: 0 });
    expect(refunds([{ completed: false, approvedRefundCents: 2000, legs: [{ amountCents: 2000, status: "FAILED", resolved: true }] }])).toEqual({ count: 0, cents: 0 });
  });

  it("adds what churches paid and still owe on their invoices for an event billed to churches", () => {
    expect(moneyFigures(money({ id: "b", churchBilled: true })).owedCents).toBeNull();
    const invoiced = moneyFigures(money({ id: "c", churchBilled: true, churchInvoices: { invoiceCount: 2, receivedCents: 30000, stillOwedCents: 12000 }, payments: [{ amountCents: 500, refundedCents: 0 }] }));
    expect(invoiced).toMatchObject({ collectedCents: 30500, owedCents: 12000 });
  });

  it("totals every event, lists six with links to Payments for each, and counts the rest", () => {
    const many = Array.from({ length: 8 }, (_, at) => money({ id: `e${at}`, startsAt: new Date(Date.UTC(2027, 0, 1 + at)), endsAt: new Date(Date.UTC(2027, 0, 2 + at)), payments: [{ amountCents: 1000, refundedCents: 0 }] }));
    const view = buildMoneyThisSeason("2026-2027", many, now);
    expect(view.rows).toHaveLength(MONEY_EVENTS_MAX);
    expect(view.moreCount).toBe(2);
    expect(view.totals).toMatchObject({ collectedCents: 8000, owedCents: 0, refundsWaiting: { count: 0, cents: 0 }, eventCount: 8 });
    expect(view.rows[0].href).toBe("/finance?event=e0");
    expect(view.footerLink.href).toBe("/finance");
  });

  it("says Billed to churches when no event has an invoice or balance yet", async () => {
    const view = buildMoneyThisSeason("2026-2027", [money({ id: "a", churchBilled: true })], now);
    expect(view.totals.owedCents).toBeNull();
    const { MoneyThisSeasonModule } = await import("@/components/home-modules");
    expect(renderToStaticMarkup(createElement(MoneyThisSeasonModule, { view }))).toContain("Billed to churches");
  });

  it("renders totals and per-event rows, and says when there is nothing to show", async () => {
    const { MoneyThisSeasonModule } = await import("@/components/home-modules");
    const view = buildMoneyThisSeason("2026-2027", [money({ id: "evt_1", name: "Fall Camporee", payments: [{ amountCents: 2500, refundedCents: 0 }] })], now);
    const html = renderToStaticMarkup(createElement(MoneyThisSeasonModule, { view }));
    expect(html).toContain('data-testid="home-money-totals"');
    expect(html).toContain('href="/finance?event=evt_1"');
    expect(html).toContain('<span translate="no">$25.00</span>');
    expect(html).toContain("None");
    const empty = renderToStaticMarkup(createElement(MoneyThisSeasonModule, { view: buildMoneyThisSeason("2026-2027", [], now) }));
    expect(empty).toContain('data-testid="home-money-empty"');
  });
});

describe("Live check-in model (#1893)", () => {
  function live(patch: Partial<LiveCheckInSource> & { id: string }): LiveCheckInSource {
    return {
      name: `Event ${patch.id}`, startsAt: new Date("2026-11-12T14:00:00Z"), endsAt: new Date("2026-11-14T20:00:00Z"), timezone: tz, archivedAt: null,
      attendeeCount: 80, checkedInCount: 20, clubCount: 12, clubsCheckedInCount: 3, lastArrivalAt: new Date("2026-11-12T14:41:00Z"), ...patch,
    };
  }

  it("is open from the first calendar day through the last, in the event's time zone, and never once archived", () => {
    const event = { startsAt: new Date("2026-11-13T23:00:00Z"), endsAt: new Date("2026-11-14T20:00:00Z"), timezone: tz, archivedAt: null };
    // Starts 5 PM Nov 13 and ends 2 PM Nov 14, Chicago time: open all of Nov 13 and 14 there, closed on Nov 12 and 15.
    expect(isCheckInOpen(event, now)).toBe(false);
    expect(isCheckInOpen(event, new Date("2026-11-13T14:00:00Z"))).toBe(true);
    expect(isCheckInOpen(event, new Date("2026-11-15T05:59:00Z"))).toBe(true);
    expect(isCheckInOpen(event, new Date("2026-11-15T06:01:00Z"))).toBe(false);
    expect(isCheckInOpen({ ...event, archivedAt: now }, new Date("2026-11-13T14:00:00Z"))).toBe(false);
    expect(isCheckInOpen({ ...event, lifecycleState: "DRAFT" }, new Date("2026-11-13T14:00:00Z"))).toBe(false);
    expect(isCheckInOpen({ ...event, lifecycleState: "TEST" }, new Date("2026-11-13T14:00:00Z"))).toBe(false);
    expect(isCheckInOpen({ ...event, lifecycleState: "IN_PROGRESS" }, new Date("2026-11-13T14:00:00Z"))).toBe(true);
  });

  it("shows people and clubs checked in and the last arrival, linking to that event's desk", () => {
    const view = buildLiveCheckIn([live({ id: "evt_1" }), live({ id: "closed", startsAt: new Date("2027-01-15T18:00:00Z"), endsAt: new Date("2027-01-17T18:00:00Z") })], now);
    expect(view.rows).toEqual([{
      id: "evt_1", name: "Event evt_1", href: "/check-in?event=evt_1", peopleText: "20 of 80 people checked in",
      clubsText: "3 of 12 clubs checked in", lastArrivalText: "Last arrival 8:41 AM CST", percentCheckedIn: 25,
    }]);
    expect(buildLiveCheckIn([live({ id: "x", clubCount: 0, checkedInCount: 0, lastArrivalAt: null })], now).rows[0]).toMatchObject({ clubsText: null, lastArrivalText: "No one checked in yet" });
    expect(lastArrivalText(null, tz)).toBe("No one checked in yet");
  });

  it("renders each open event with a link to check in", async () => {
    const { LiveCheckInModule } = await import("@/components/home-modules");
    const html = renderToStaticMarkup(createElement(LiveCheckInModule, { view: buildLiveCheckIn([live({ id: "evt_1", name: "Fall Camporee" })], now) }));
    expect(html).toContain('href="/check-in?event=evt_1"');
    expect(html).toContain("20 of 80 people checked in");
    expect(renderToStaticMarkup(createElement(LiveCheckInModule, { view: null }))).toMatch(/unavailable/i);
  });
});

describe("Home board with Live check-in resting (#1893)", () => {
  it("leaves a resting module off the board and out of Arrange, and keeps it in Customize", async () => {
    const { StaffHomeBoard } = await import("@/components/staff-home-board");
    const modules = resolveHomeLayout(null, events).modules;
    const html = renderToStaticMarkup(createElement(StaffHomeBoard, { modules, bodies: { "needs-you": "A" }, resting: ["live-check-in"], defaultArranging: true }));
    expect(html).not.toContain('data-module="live-check-in"');
    expect(html).not.toContain('aria-label="Move Live check-in"');
    expect(html).toContain('data-module="needs-you"');
  });

  it("reorders around a resting module so it keeps its place", async () => {
    const { reorderShown } = await import("@/components/staff-home-board");
    const modules = [
      { key: "live-check-in", label: "Live check-in", shown: true, hideable: true },
      { key: "needs-you", label: "Needs you", shown: true, hideable: false },
      { key: "season-numbers", label: "Season numbers", shown: true, hideable: true },
    ] as const;
    expect(reorderShown([...modules], ["season-numbers", "needs-you"], new Set<HomeModuleKey>(["live-check-in"])).map((m) => m.key)).toEqual(["live-check-in", "season-numbers", "needs-you"]);
  });
});

describe("Home page wiring (#1893)", () => {
  async function renderHome(held: AdminRoles, extra: Record<string, unknown>) {
    vi.resetModules();
    const seen: { props?: { bodies: Record<string, unknown>; resting?: string[] } } = {};
    vi.doMock("server-only", () => ({}));
    vi.doMock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));
    vi.doMock("@/modules/access/current-session", () => ({ getCurrentSession: async () => ({ user: { id: "user_a", globalRole: null } }) }));
    vi.doMock("@/modules/access/admin-roles", () => ({ resolveAdminRoles: async () => held }));
    vi.doMock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
    vi.doMock("@/modules/system-admin/home-needs-repository", () => ({ loadNeedsInput: async () => ({ held: [], events: null, attention: null }) }));
    vi.doMock("@/modules/system-admin/home-needs-model", () => ({ buildNeedsView: () => ({ allClear: false, noAdminRole: false, sections: [] }) }));
    vi.doMock("@/modules/system-admin/home-coming-up-repository", () => ({ loadComingUp: async () => ({ events: [], nextStep: null }) }));
    vi.doMock("@/modules/system-admin/home-modules-repository", () => ({ loadHomeModules: async () => ({}) }));
    vi.doMock("@/modules/system-admin/home-extra-modules-repository", () => ({ loadHomeExtraModules: async () => extra }));
    vi.doMock("@/modules/system-admin/home-layout-repository", () => ({ loadHomeLayout: async (_id: string, roles: AdminRoles) => resolveHomeLayout(null, roles) }));
    vi.doMock("@/components/staff-install-card", () => ({ StaffInstallCard: () => null }));
    vi.doMock("@/components/staff-page-header", () => ({ StaffPageHeader: () => null }));
    vi.doMock("@/components/home-pages", () => ({ NeedsYouPage: () => null, ComingUpPage: () => null }));
    vi.doMock("@/components/staff-home-board", () => ({ StaffHomeBoard: (props: typeof seen.props) => { seen.props = props; return null; } }));
    const page = await import("@/app/(workspace)/home/page");
    const tree = await page.default();
    // The board is rendered by React later; walk the tree to its props.
    const find = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const element = node as { props?: Record<string, unknown> & { children?: unknown } };
      if (element.props && "modules" in element.props && "bodies" in element.props) seen.props = element.props as typeof seen.props;
      const children = element.props?.children;
      (Array.isArray(children) ? children : [children]).forEach(find);
    };
    find(tree);
    return seen.props!;
  }

  it("keeps Live check-in off Home while no check-in is open", async () => {
    const props = await renderHome(events, { "live-check-in": { rows: [] } });
    expect(props.resting).toEqual(["live-check-in"]);
    expect(props.bodies["live-check-in"]).toBeUndefined();
  });

  it("shows Live check-in while check-in is open, and Unavailable when its read failed", async () => {
    const open = await renderHome(events, { "live-check-in": { rows: [{ id: "evt_1" }] } });
    expect(open.resting).toEqual([]);
    expect(open.bodies["live-check-in"]).toBeDefined();
    const failed = await renderHome(events, { "live-check-in": null });
    expect(failed.resting).toEqual([]);
    expect(failed.bodies["live-check-in"]).toBeDefined();
  });

  it("gives Club applications a body for a Clubs admin", async () => {
    const props = await renderHome(clubs, { "club-applications": buildClubApplications(0, [], now) });
    expect(props.bodies["club-applications"]).toBeDefined();
  });
});
