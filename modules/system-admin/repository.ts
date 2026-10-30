import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { getOutboxQueueHealth } from "@/modules/communications/outbox-sweep";
import { getSweepHeartbeat } from "@/modules/operations/sweep-heartbeat-repository";
import {
  buildSystemAdminDashboard,
  type SystemAdminEventSource,
} from "@/modules/system-admin/dashboard";

export function moneyToCents(value: { toString(): string } | number) {
  return Math.round(Number(value) * 100);
}

/** The per-event numbers the System home and the Events Administrator dashboard (#1227) both show. */
const dashboardEventSelect = {
  id: true,
  archivedAt: true,
  lifecycleState: true,
  slug: true,
  name: true,
  startsAt: true,
  endsAt: true,
  timezone: true,
  location: true,
  capacity: true,
  isPublished: true,
  registrationOpensOn: true,
  registrationClosesOn: true,
  waitlistEnabled: true,
  // Keep these filters in step with `countEventsAdminWaiting` (modules/events/events-admin-home-repository.ts, #1245):
  // the Events Administrator pill must equal the dashboard's Need attention total.
  registrations: {
    where: { status: { in: ["SUBMITTED", "CONFIRMED"] } },
    select: {
      status: true,
      totalAmount: true,
      payments: {
        where: { status: "SUCCEEDED" },
        select: {
          amount: true,
          refunds: {
            where: { status: "SUCCEEDED" },
            select: { amount: true },
          },
        },
      },
    },
  },
  attendees: {
    where: { registration: { status: { in: ["SUBMITTED", "CONFIRMED"] } } },
    select: { id: true },
  },
  checkIns: {
    where: {
      undoneAt: null,
      attendee: { registration: { status: { in: ["SUBMITTED", "CONFIRMED"] } } },
    },
    select: { id: true },
  },
  memberships: {
    where: { status: "ACTIVE" },
    select: { id: true },
  },
  registrationForms: {
    where: { versions: { some: { status: "PUBLISHED" } } },
    select: { id: true },
  },
  waitlistEntries: {
    where: { status: "WAITING" },
    select: { id: true },
  },
  importRuns: {
    where: {
      OR: [
        { status: "FAILED" },
        { errors: { gt: 0 } },
        { warnings: { gt: 0 } },
      ],
    },
    select: { status: true, errors: true },
  },
  messageOutbox: {
    where: {
      OR: [
        { status: "FAILED" },
        { providerDeliveryStatus: { in: ["BOUNCED", "COMPLAINED", "FAILED"] } },
      ],
    },
    select: { id: true },
  },
} satisfies Prisma.EventSelect;

type DashboardEventRow = Prisma.EventGetPayload<{ select: typeof dashboardEventSelect }>;

export type DashboardEventFilter = {
  /**
   * Only these events. `undefined` reads every event; an empty list reads none, and runs no query at all, so a person
   * with no events can never fall through to an unfiltered read.
   */
  eventIds?: readonly string[];
  /** Only events that have not ended at this instant (`endsAt >= endsOnOrAfter`). */
  endsOnOrAfter?: Date;
};

/** The one event read behind both dashboards: archived events (#635) are never read, whatever the filter says. */
export async function findDashboardEvents(
  prisma: Pick<PrismaClient, "event">,
  filter: DashboardEventFilter = {},
): Promise<DashboardEventRow[]> {
  if (filter.eventIds !== undefined && filter.eventIds.length === 0) return [];
  const where: Prisma.EventWhereInput = { archivedAt: null };
  if (filter.eventIds !== undefined) where.id = { in: [...filter.eventIds] };
  if (filter.endsOnOrAfter) where.endsAt = { gte: filter.endsOnOrAfter };
  return prisma.event.findMany({ where, orderBy: { startsAt: "asc" }, select: dashboardEventSelect });
}

/** The row shaped for `buildSystemAdminDashboard` (money in cents). */
export function toDashboardEventSource(event: DashboardEventRow): SystemAdminEventSource {
  return {
    id: event.id,
    slug: event.slug,
    name: event.name,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.timezone,
    location: event.location,
    capacity: event.capacity,
    isPublished: event.isPublished,
    archivedAt: event.archivedAt,
    lifecycleState: event.lifecycleState,
    registrationOpensOn: event.registrationOpensOn,
    registrationClosesOn: event.registrationClosesOn,
    waitlistEnabled: event.waitlistEnabled,
    registrations: event.registrations.map((registration) => ({
      status: registration.status,
      totalAmountCents: moneyToCents(registration.totalAmount),
      payments: registration.payments.map((payment) => ({
        amountCents: moneyToCents(payment.amount),
        refunds: payment.refunds.map((refund) => ({
          amountCents: moneyToCents(refund.amount),
        })),
      })),
    })),
    attendeeCount: event.attendees.length,
    checkedInCount: event.checkIns.length,
    activeStaffCount: event.memberships.length,
    publishedFormCount: event.registrationForms.length,
    waitingCount: event.waitlistEntries.length,
    importIssueCount: event.importRuns.filter((run) => run.status === "FAILED" || run.errors > 0).length,
    importWarningCount: event.importRuns.filter((run) => run.status !== "FAILED" && run.errors === 0).length,
    deliveryIssueCount: event.messageOutbox.length,
  };
}

export async function getSystemAdminDashboard(now = new Date()) {
  const prisma = getPrisma();
  const [events, activeUserCount, pendingUserCount, systemAdminCount, unresolvedAlertCount] =
    await Promise.all([
      findDashboardEvents(prisma),
      prisma.user.count({ where: { accountStatus: "ACTIVE" } }),
      prisma.user.count({ where: { accountStatus: "PENDING_ACTIVATION" } }),
      prisma.user.count({ where: { globalRole: "SYSTEM_ADMIN", accountStatus: "ACTIVE" } }),
      prisma.alertNotification.count({ where: { resolvedAt: null } }),
    ]);

  const eventSources = events.map(toDashboardEventSource);

  return buildSystemAdminDashboard({
    events: eventSources,
    activeUserCount,
    pendingUserCount,
    systemAdminCount,
    unresolvedAlertCount,
  }, now);
}

/**
 * The live signals behind the command center's "System health" panel: whether
 * the scheduled email sweep is still running, whether email is backing up, and
 * which alerts are still open. Each read fails on its own so one broken signal
 * shows as "unknown" instead of taking the page down.
 */
export async function getSystemHealth(now = new Date()) {
  const [sweep, outbox, alerts] = await Promise.all([
    getSweepHeartbeat(now).catch((error) => {
      logError("Command center could not read the sweep heartbeat", error);
      return null;
    }),
    getOutboxQueueHealth(now).catch((error) => {
      logError("Command center could not read the email queue", error);
      return null;
    }),
    getPrisma().alertNotification.findMany({
      where: { resolvedAt: null },
      orderBy: { firstSeenAt: "asc" },
      take: 5,
      select: { key: true, severity: true, summary: true, firstSeenAt: true },
    }).catch((error) => {
      logError("Command center could not read open alerts", error);
      return null;
    }),
  ]);
  return { sweep, outbox, alerts };
}
