import "server-only";

import { getPrisma } from "@/lib/prisma";
import { selectionsMissingTickets } from "@/modules/meals/ticket-repository";
import {
  CLUB_ORDER_OPEN_AFTER_MS,
  HONOR_OFFER_OVERDUE_AFTER_MS,
  IMPORT_STUCK_AFTER_MS,
  checkInStationsResult,
  clubOrdersResult,
  honorOffersOverdueResult,
  importsStuckResult,
  lodgingChangeRequestsResult,
  lodgingOffersLapsedResult,
  mealTicketsResult,
  scholarshipPledgesResult,
} from "./event-ops-signals";
import type { defineProvider, Read, ReportContext, SignalProvider } from "./providers";

/**
 * The "Event operations" checks (#1379). Read-only: counts, times and event names only, never a person, a registration
 * or an attendee. Built from `providers.ts`'s helpers, passed in so this file never imports that one at run time (it
 * appends this list, so importing it back would be a cycle). Each row is read once through `ctx.once`, so a failed
 * read becomes that row's "unavailable" and is never shown as OK or as zero.
 */

type EventReads<T> = { readAt: Date; events: Array<{ id: string; name: string }>; results: Array<{ id: string; name: string; value: T }>; failed: number };
type Rows = Awaited<ReturnType<Parameters<typeof defineProvider>[2]>>;

export type EventOpsKit = {
  defineProvider: typeof defineProvider;
  reportEvents: (ctx: ReportContext) => Promise<Read<Array<{ id: string; name: string }>>>;
  perEvent: <T>(ctx: ReportContext, key: string, run: (eventId: string) => Promise<T>) => Promise<Read<EventReads<T>>>;
  tried: (read: Read<unknown>, reason?: string) => { checkedAt: string; whenLabel: string; state: "unavailable"; resultText: string };
  iso: (date: Date) => string;
  m: (key: string, name: string, description: string, fixHref?: string | null, fixLabel?: string | null) => Parameters<typeof defineProvider>[1][number];
  couldNotReadNote: (failed: number) => string;
  eventHref: (path: string, eventId: string, extra?: string) => string;
};

type Window = { events: Array<{ id: string; name: string }> };

export function buildEventOpsProviders(kit: EventOpsKit): SignalProvider[] {
  const { defineProvider: define, reportEvents, perEvent, tried, iso, m, eventHref } = kit;

  /** One read scoped to the report's event window: the events first, then `load` with their ids. */
  function inWindow<T>(ctx: ReportContext, key: string, load: (ids: string[]) => Promise<T>) {
    return ctx.once(key, async () => {
      const eventsRead = await reportEvents(ctx);
      if (!eventsRead.ok) throw new Error("events could not be read");
      const window: Window = { events: eventsRead.value };
      return { window, data: await load(window.events.map((event) => event.id)) };
    });
  }

  /** The names and first link target (in the window's own order) of the events in `groups`. */
  function affected(window: Window, groups: ReadonlyArray<{ eventId: string }>) {
    const set = new Set(groups.map((group) => group.eventId));
    const events = window.events.filter((event) => set.has(event.id));
    return { names: events.map((event) => event.name), first: events[0]?.id ?? null };
  }

  const sum = (groups: ReadonlyArray<{ _count: { _all: number } }>) => groups.reduce((total, group) => total + group._count._all, 0);

  /** A row from a windowed read: a failed read is that row's unavailable, never OK. */
  function windowedRow<T>(
    key: string,
    read: Awaited<ReturnType<typeof inWindow<T>>>,
    build: (data: T, window: Window) => { state: Rows[number]["state"]; resultText: string; link?: string | null },
  ): Rows[number] {
    if (!read.ok) return { key, ...tried(read) };
    const built = build(read.value.data, read.value.window);
    return {
      key,
      checkedAt: iso(read.readAt),
      whenLabel: "Checked",
      state: built.state,
      resultText: built.resultText,
      ...(built.link ? { fixHref: built.link } : {}),
    };
  }

  return [
    define("event-operations", [
      m("imports-stuck", "Imports stuck", "Imports still running, or still waiting to be committed, after more than an hour.", "/imports", "Open imports"),
      m("checkin-stations", "Check-in stations left open", "Check-in stations that expired without being stopped or revoked.", "/check-in", "Open check-in"),
      m("honors-offers-overdue", "Honors class offers overdue", "Honors class waitlist offers more than 30 minutes past their expiry.", "/more/honors", "Open honors"),
      m("lodging-offers-lapsed", "Lodging offers lapsed", "Lodging waitlist offers that have passed their expiry and are not yet handled.", "/more/lodging", "Open lodging"),
      m("lodging-change-requests", "Lodging change requests open", "Lodging change requests that no one has resolved yet.", "/more/lodging/requests", "Open change requests"),
      m("meal-tickets-missing", "Meal tickets missing", "Meal selections whose tickets do not match what the selection calls for.", "/more/meals", "Open meals"),
      m("scholarship-pledges-unsettled", "Scholarship pledges not received", "Scholarship awards pledged by a sponsor whose payment has not been received.", "/finance/scholarship-fund", "Open scholarship fund"),
      m("club-orders-open", "Club supply orders open", "Club supply orders ordered more than 30 days ago and not yet received.", "/admin/club-supplies", "Open club supplies"),
    ], async (ctx) => {
      const rows: Rows = [];
      const now = ctx.now;
      const ago = (ms: number) => new Date(now.getTime() - ms);

      // 1. Imports stuck.
      const imports = await inWindow(ctx, "event-ops:imports", async (ids) => {
        const prisma = getPrisma();
        const [stuck, failed] = await Promise.all([
          prisma.importRun.groupBy({
            by: ["eventId", "status"],
            where: { eventId: { in: ids }, status: { in: ["RUNNING", "PENDING"] }, startedAt: { lt: ago(IMPORT_STUCK_AFTER_MS) } },
            _count: { _all: true },
          }),
          prisma.importRun.count({ where: { eventId: { in: ids }, status: "FAILED" } }),
        ]);
        return { stuck, failed };
      });
      rows.push(windowedRow("imports-stuck", imports, ({ stuck, failed }, window) => {
        const running = sum(stuck.filter((group) => group.status === "RUNNING"));
        const pending = sum(stuck.filter((group) => group.status === "PENDING"));
        const where = affected(window, stuck);
        return { ...importsStuckResult({ running, pending, failed, names: where.names }), link: where.first ? eventHref("/imports", where.first) : null };
      }));

      // 2. Check-in stations left open (a count only).
      const stations = await inWindow(ctx, "event-ops:checkin-stations", async (ids) =>
        getPrisma().checkInStation.groupBy({
          by: ["eventId"],
          where: { eventId: { in: ids }, expiresAt: { lt: now }, stoppedAt: null, revokedAt: null },
          _count: { _all: true },
        }));
      rows.push(windowedRow("checkin-stations", stations, (groups, window) => {
        const first = affected(window, groups).first;
        return { ...checkInStationsResult(sum(groups)), link: first ? eventHref("/check-in", first) : null };
      }));

      // 3. Honors class offers overdue. An OFFERED entry with no expiry is resolved by the sweep at once, so it is not counted.
      const honors = await inWindow(ctx, "event-ops:honors-offers", async (ids) =>
        getPrisma().honorClassWaitlistEntry.groupBy({
          by: ["eventId"],
          where: { eventId: { in: ids }, status: "OFFERED", offerExpiresAt: { lt: ago(HONOR_OFFER_OVERDUE_AFTER_MS) } },
          _count: { _all: true },
        }));
      rows.push(windowedRow("honors-offers-overdue", honors, (groups, window) => {
        const where = affected(window, groups);
        return { ...honorOffersOverdueResult(sum(groups), where.names), link: where.first ? eventHref("/more/honors", where.first) : null };
      }));

      // 4. Lodging offers lapsed (the same rule as `isOfferLapsed`: expiry at or before now).
      const lodgingOffers = await inWindow(ctx, "event-ops:lodging-offers", async (ids) =>
        getPrisma().eventLodgingWaitlistEntry.groupBy({
          by: ["eventId"],
          where: { eventId: { in: ids }, status: "OFFERED", offerExpiresAt: { lte: now } },
          _count: { _all: true },
        }));
      rows.push(windowedRow("lodging-offers-lapsed", lodgingOffers, (groups, window) => {
        const where = affected(window, groups);
        return { ...lodgingOffersLapsedResult(sum(groups), where.names), link: where.first ? eventHref("/more/lodging", where.first) : null };
      }));

      // 5. Lodging change requests open (a count only).
      const changeRequests = await inWindow(ctx, "event-ops:lodging-change-requests", async (ids) =>
        getPrisma().eventLodgingChangeRequest.groupBy({
          by: ["eventId"],
          where: { eventId: { in: ids }, resolvedAt: null },
          _count: { _all: true },
        }));
      rows.push(windowedRow("lodging-change-requests", changeRequests, (groups, window) => {
        const first = affected(window, groups).first;
        return { ...lodgingChangeRequestsResult(sum(groups)), link: first ? eventHref("/more/lodging/requests", first) : null };
      }));

      // 6. Meal tickets missing, one read per event like the ledger check. The selection ids are only counted.
      const tickets = await perEvent(ctx, "meal-tickets-missing", (eventId) => selectionsMissingTickets(getPrisma() as Parameters<typeof selectionsMissingTickets>[0], eventId));
      if (!tickets.ok) rows.push({ key: "meal-tickets-missing", ...tried(tickets) });
      else {
        const { results, failed, readAt } = tickets.value;
        const withMissing = results.filter((result) => result.value.length > 0);
        const missing = withMissing.reduce((total, result) => total + result.value.length, 0);
        const built = mealTicketsResult({ missing, names: withMissing.map((result) => result.name), failed, checked: results.length });
        rows.push({
          key: "meal-tickets-missing",
          checkedAt: iso(readAt),
          whenLabel: built.state === "unavailable" ? "Tried" : "Checked",
          ...built,
          ...(withMissing[0] ? { fixHref: eventHref("/more/meals", withMissing[0].id) } : {}),
        });
      }

      // 7. Scholarship pledges not received: the repository's rule for a pledge still owed (an unreversed adjustment).
      const pledges = await inWindow(ctx, "event-ops:scholarship-pledges", async (ids) =>
        getPrisma().scholarshipAward.count({
          where: { eventId: { in: ids }, pledged: true, settledAt: null, adjustment: { reversedBy: null } },
        }));
      rows.push(windowedRow("scholarship-pledges-unsettled", pledges, (count) => scholarshipPledgesResult(count)));

      // 8. Club supply orders open: not tied to an event, so a count across all of them.
      const orders = await ctx.once("event-ops:club-orders", async () =>
        getPrisma().clubSupplyOrderBatch.count({ where: { status: "ORDERED", createdAt: { lt: ago(CLUB_ORDER_OPEN_AFTER_MS) } } }));
      rows.push(!orders.ok
        ? { key: "club-orders-open", ...tried(orders) }
        : { key: "club-orders-open", checkedAt: iso(orders.readAt), whenLabel: "Checked", ...clubOrdersResult(orders.value) });

      return rows;
    }),
  ];
}
