import "server-only";

import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import type { AdminRoles } from "@/modules/access/admin-roles-domain";
import type { EventPermission } from "@/modules/access/permissions";
import { listActiveEventPermissionsForUser } from "@/modules/access/membership-repository";
import { countWaitingNewClubApplications, listOldestWaitingClubApplications } from "@/modules/club-applications/repository";
import { openStatuses } from "@/modules/cancellation-requests/domain";
import { activeRegistrationStatuses } from "@/modules/events/lifecycle";
import { loadEventLedger } from "@/modules/invoices/ledger-repository";
import { HOME_MODULES, type HomeModuleKey } from "@/modules/system-admin/home-layout-domain";
import { clubYearInstants, conferenceClubYear } from "@/modules/system-admin/home-modules-model";
import {
  CLUB_APPLICATIONS_MAX,
  buildClubApplications,
  buildLiveCheckIn,
  buildMoneyThisSeason,
  isCheckInOpen,
  type ClubApplicationsView,
  type LiveCheckInView,
  type MoneyEventSource,
  type MoneyThisSeasonView,
} from "@/modules/system-admin/home-extra-modules-model";

/** What each of these modules reads. `null` means the read failed (shown as "Unavailable"); an absent key was not read. */
export type HomeExtraModuleData = {
  "club-applications"?: ClubApplicationsView | null;
  "money-this-season"?: MoneyThisSeasonView | null;
  "live-check-in"?: LiveCheckInView | null;
};

/** Runs one read; a failure is logged and becomes `null`, which the module shows as "Unavailable" and never as zero. */
async function attempt<T>(label: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    logError(`Home module read could not load: ${label}`, error);
    return null;
  }
}

/** The same rounding the dashboards use (`moneyToCents`). */
const cents = (value: { toString(): string } | number) => Math.round(Number(value) * 100);

const ACTIVE = [...activeRegistrationStatuses];

/**
 * Of `eventIds`, the events where the person holds `permission` now: every one for a system administrator, otherwise
 * from their active memberships (and a Clubs Administrator's EVENT_ADMIN set on club events), read fresh each request,
 * the same permissions the event pages check.
 */
async function eventsWithPermission(userId: string, roles: AdminRoles, eventIds: readonly string[], permission: EventPermission): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  if (roles.systemAdmin) return new Set(eventIds);
  const byEvent = await listActiveEventPermissionsForUser(userId, eventIds);
  return new Set(eventIds.filter((id) => byEvent.get(id)?.includes(permission)));
}

/**
 * Reads Club applications, Money this season and Live check-in for the person's staff Home (#1893), only for the modules
 * turned on and allowed by `roles` (from `resolveAdminRoles` on the server). Money and Live check-in are then narrowed
 * to the events where the person holds MANAGE_FINANCE or MANAGE_CHECK_IN, the permissions the Payments and Check-in
 * pages check, so a number is never shown for an event the person cannot open. Read-only.
 */
export async function loadHomeExtraModules(userId: string, roles: AdminRoles, shown: ReadonlySet<HomeModuleKey>, now = new Date()): Promise<HomeExtraModuleData> {
  const allowed = (key: HomeModuleKey) => shown.has(key) && HOME_MODULES.find((module) => module.key === key)?.mayUse(roles) === true;
  const data: HomeExtraModuleData = {};
  await Promise.all([
    allowed("club-applications")
      ? attempt("club applications", async () => {
        const viewer = roles.systemAdmin ? "SYSTEM_ADMIN" : "CLUBS_ADMIN";
        const [count, oldest] = await Promise.all([
          countWaitingNewClubApplications(viewer),
          listOldestWaitingClubApplications(viewer, CLUB_APPLICATIONS_MAX),
        ]);
        return buildClubApplications(count, oldest, now);
      }).then((view) => { data["club-applications"] = view; })
      : null,
    allowed("money-this-season")
      ? attempt("money this season", () => readMoneyThisSeason(userId, roles, now)).then((view) => { data["money-this-season"] = view; })
      : null,
    allowed("live-check-in")
      ? attempt("live check-in", () => readLiveCheckIn(userId, roles, now)).then((view) => { data["live-check-in"] = view; })
      : null,
  ]);
  return data;
}

/** This club year's events (starting Sept 1 to Aug 31 on the conference calendar, as Season numbers), not archived. */
async function readMoneyThisSeason(userId: string, roles: AdminRoles, now: Date): Promise<MoneyThisSeasonView> {
  const prisma = getPrisma();
  const clubYear = conferenceClubYear(now);
  const { from, to } = clubYearInstants(clubYear);
  const season = await prisma.event.findMany({
    where: { archivedAt: null, startsAt: { gte: from, lt: to } },
    select: { id: true, name: true, startsAt: true, endsAt: true, billingMode: true },
  });
  const permitted = await eventsWithPermission(userId, roles, season.map((event) => event.id), "MANAGE_FINANCE");
  const events = season.filter((event) => permitted.has(event.id));
  if (events.length === 0) return buildMoneyThisSeason(clubYear, [], now);
  const ids = events.map((event) => event.id);
  // Church invoices, on events billed to churches and on General events where a church's promo code was invoiced (#399).
  const invoiced = await prisma.invoice.groupBy({ by: ["eventId"], where: { eventId: { in: ids }, baseNumber: { not: null } }, _count: { _all: true } });
  const invoicedIds = invoiced.map((group) => group.eventId);
  const withRefund = { eventId: { in: ids }, proposedRefundCents: { gt: 0 } };
  const [payments, registrations, open, approvedNotStarted, executions, pending, cancellationRefundIds, ledgers] = await Promise.all([
    prisma.payment.findMany({
      where: { eventId: { in: ids }, status: "SUCCEEDED" },
      select: { eventId: true, amount: true, refunds: { where: { status: "SUCCEEDED" }, select: { amount: true } } },
    }),
    // The balance input the dashboards read (`dashboardEventSelect`): active registrations, successful payments and refunds.
    prisma.registration.findMany({
      where: { eventId: { in: ids }, status: { in: ACTIVE } },
      select: {
        eventId: true,
        totalAmount: true,
        payments: { where: { status: "SUCCEEDED" }, select: { amount: true, refunds: { where: { status: "SUCCEEDED" }, select: { amount: true } } } },
      },
    }),
    // Cancellation refunds still to go back: requests not decided yet, approved ones nobody has carried out, and those
    // being carried out or carried out with a refund that failed and nobody settled.
    prisma.cancellationRequest.groupBy({
      by: ["eventId"],
      where: { ...withRefund, status: { in: [...openStatuses] } },
      _count: { _all: true },
      _sum: { proposedRefundCents: true },
    }),
    prisma.cancellationRequest.groupBy({
      by: ["eventId"],
      where: { ...withRefund, status: "APPROVED", execution: { is: null } },
      _count: { _all: true },
      _sum: { proposedRefundCents: true },
    }),
    prisma.cancellationExecution.findMany({
      where: {
        eventId: { in: ids },
        approvedRefundCents: { gt: 0 },
        OR: [{ status: { not: "COMPLETED" } }, { refunds: { some: { status: "FAILED", resolvedAt: null } } }],
      },
      select: { eventId: true, status: true, approvedRefundCents: true, refunds: { select: { amountCents: true, status: true, resolvedAt: true, refundId: true } } },
    }),
    prisma.refund.findMany({ where: { eventId: { in: ids }, status: "PENDING" }, select: { id: true, eventId: true, amount: true } }),
    // A cancellation's refund already counts above, so its processor refund is not counted twice.
    prisma.cancellationExecutionRefund.findMany({ where: { eventId: { in: ids }, refundId: { not: null } }, select: { refundId: true } }),
    // Church invoices, as the Event money report adds them up.
    Promise.all(invoicedIds.map(async (eventId) => [eventId, await loadEventLedger(eventId)] as const)),
  ]);
  // A cancellation refund line is brought up to date only when someone carries the cancellation on, so read its processor
  // refund's own status, which the Square webhook keeps current (as the cancellation page does, `withRefundStatuses`).
  const legRefundIds = executions.flatMap((execution) => execution.refunds.flatMap((leg) => (leg.refundId && !leg.resolvedAt ? [leg.refundId] : [])));
  const legRefundStatus = new Map(legRefundIds.length === 0
    ? []
    : (await prisma.refund.findMany({ where: { id: { in: legRefundIds } }, select: { id: true, status: true } })).map((refund) => [refund.id, refund.status]));
  const legStatus = (leg: { status: string; resolvedAt: Date | null; refundId: string | null }) => {
    const refund = leg.refundId && !leg.resolvedAt ? legRefundStatus.get(leg.refundId) : undefined;
    if (refund === "SUCCEEDED") return "DONE";
    if (refund === "FAILED") return "FAILED";
    return leg.status;
  };
  const sources = new Map<string, MoneyEventSource>(events.map((event) => [event.id, {
    id: event.id,
    name: event.name,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    churchBilled: event.billingMode === "DEFERRED_ORGANIZATION_INVOICE",
    payments: [],
    activeRegistrations: [],
    churchInvoices: null,
    cancellationRefunds: { undecidedOrNotStarted: { count: 0, cents: 0 }, executions: [] },
    pendingRefunds: { count: 0, cents: 0 },
  }]));
  for (const payment of payments) {
    sources.get(payment.eventId)?.payments.push({
      amountCents: cents(payment.amount),
      refundedCents: payment.refunds.reduce((total, refund) => total + cents(refund.amount), 0),
    });
  }
  for (const registration of registrations) {
    sources.get(registration.eventId)?.activeRegistrations.push({
      totalAmountCents: cents(registration.totalAmount),
      payments: registration.payments.map((payment) => ({
        amountCents: cents(payment.amount),
        refunds: payment.refunds.map((refund) => ({ amountCents: cents(refund.amount) })),
      })),
    });
  }
  for (const group of [...open, ...approvedNotStarted]) {
    const waiting = sources.get(group.eventId)?.cancellationRefunds.undecidedOrNotStarted;
    if (!waiting) continue;
    waiting.count += group._count._all;
    waiting.cents += group._sum.proposedRefundCents ?? 0;
  }
  for (const execution of executions) {
    sources.get(execution.eventId)?.cancellationRefunds.executions.push({
      completed: execution.status === "COMPLETED",
      approvedRefundCents: execution.approvedRefundCents,
      legs: execution.refunds.map((leg) => ({ amountCents: leg.amountCents, status: legStatus(leg), resolved: leg.resolvedAt !== null })),
    });
  }
  const counted = new Set(cancellationRefundIds.map((leg) => leg.refundId));
  for (const refund of pending) {
    const source = sources.get(refund.eventId);
    if (!source || counted.has(refund.id)) continue;
    source.pendingRefunds.count += 1;
    source.pendingRefunds.cents += cents(refund.amount);
  }
  for (const [eventId, ledger] of ledgers) {
    const source = sources.get(eventId);
    if (!source) continue;
    source.churchInvoices = {
      invoiceCount: ledger.length,
      receivedCents: ledger.reduce((total, invoice) => total + invoice.figures.paidCents, 0),
      stillOwedCents: ledger.reduce((total, invoice) => total + invoice.figures.outstandingCents, 0),
    };
  }
  return buildMoneyThisSeason(clubYear, [...sources.values()], now);
}

/** A day either side covers every time zone, so the coarse read never misses an event whose calendar days include today. */
const WINDOW_SLACK_MS = 2 * 86_400_000;

async function readLiveCheckIn(userId: string, roles: AdminRoles, now: Date): Promise<LiveCheckInView> {
  const prisma = getPrisma();
  const candidates = await prisma.event.findMany({
    where: {
      archivedAt: null,
      startsAt: { lte: new Date(now.getTime() + WINDOW_SLACK_MS) },
      endsAt: { gte: new Date(now.getTime() - WINDOW_SLACK_MS) },
    },
    select: { id: true, name: true, startsAt: true, endsAt: true, timezone: true, archivedAt: true, lifecycleState: true },
  });
  const open = candidates.filter((event) => isCheckInOpen(event, now));
  const permitted = await eventsWithPermission(userId, roles, open.map((event) => event.id), "MANAGE_CHECK_IN");
  const events = open.filter((event) => permitted.has(event.id));
  if (events.length === 0) return { rows: [] };
  const ids = events.map((event) => event.id);
  const activeRegistration = { status: { in: ACTIVE } };
  // The dashboards' rule: a check-in counts while it is not undone and its registration is active.
  const activeCheckIn = { undoneAt: null, attendee: { registration: activeRegistration } };
  const [attendees, checkIns, clubs, clubsIn] = await Promise.all([
    prisma.registrationAttendee.groupBy({ by: ["eventId"], where: { eventId: { in: ids }, registration: activeRegistration }, _count: { _all: true } }),
    prisma.checkIn.groupBy({ by: ["eventId"], where: { eventId: { in: ids }, ...activeCheckIn }, _count: { _all: true }, _max: { checkedInAt: true } }),
    prisma.clubEventRegistration.groupBy({ by: ["eventId"], where: { eventId: { in: ids }, registration: activeRegistration }, _count: { _all: true } }),
    // A club counts as checked in once at least one of its people is.
    prisma.clubEventRegistration.groupBy({
      by: ["eventId"],
      where: { eventId: { in: ids }, registration: { ...activeRegistration, attendees: { some: { checkIns: { some: { undoneAt: null } } } } } },
      _count: { _all: true },
    }),
  ]);
  const count = (groups: ReadonlyArray<{ eventId: string; _count: { _all: number } }>, eventId: string) => groups.find((group) => group.eventId === eventId)?._count._all ?? 0;
  return buildLiveCheckIn(events.map((event) => ({
    ...event,
    attendeeCount: count(attendees, event.id),
    checkedInCount: count(checkIns, event.id),
    clubCount: count(clubs, event.id),
    clubsCheckedInCount: count(clubsIn, event.id),
    lastArrivalAt: checkIns.find((group) => group.eventId === event.id)?._max.checkedInAt ?? null,
  })), now);
}
