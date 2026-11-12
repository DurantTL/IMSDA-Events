import { getPrisma } from "@/lib/prisma";
import { activeRegistrationStatuses } from "@/modules/events/lifecycle";
import { registrationBalanceCents } from "@/modules/payments/square-domain";
import { attendeeBalanceCents } from "@/modules/registrations/finance-view";
import {
  LIVE_CHANGES_LIMIT,
  collapseCheckInChanges,
  type LiveBalanceChange,
  type LiveCheckInChanges,
} from "@/modules/checkin/live-changes";

/** The balance the desk shows for a registration: the shared balance rule, then the church-billing rule the page load applies. */
export function liveRegistrationBalanceCents(registration: {
  totalAmount: { toString(): string } | number;
  event: { billingMode: string };
  payments: Array<{ amount: { toString(): string } | number; refunds: Array<{ amount: { toString(): string } | number }> }>;
}) {
  return attendeeBalanceCents({
    balanceCents: registrationBalanceCents(registration),
    isDeferredOrganizationBilling: registration.event.billingMode === "DEFERRED_ORGANIZATION_INVOICE",
  });
}

/**
 * Attendees whose check-in state changed since `since` (#825), for the other
 * desk devices' live lists, and registrations whose balance changed through a
 * payment or refund (#1577). Returns ids, times, confirmation codes and
 * balances, nothing else. The server clock is read before the query so the
 * caller's overlap window always covers a commit that lands while this runs.
 */
export async function listCheckInChanges(eventId: string, since: Date): Promise<LiveCheckInChanges> {
  const now = new Date();
  const prisma = getPrisma();
  const [rows, moneyRows] = await Promise.all([
    prisma.checkIn.findMany({
      where: {
        eventId,
        OR: [{ checkedInAt: { gte: since } }, { undoneAt: { gte: since } }],
      },
      select: { registrationAttendeeId: true, checkedInAt: true, undoneAt: true },
      orderBy: { checkedInAt: "desc" },
      take: LIVE_CHANGES_LIMIT + 1,
    }),
    // A payment or refund written at or after `since`. Station card notes are not payments, so they never appear.
    prisma.registration.findMany({
      where: {
        eventId,
        status: { in: [...activeRegistrationStatuses] },
        OR: [
          { payments: { some: { updatedAt: { gte: since } } } },
          { payments: { some: { refunds: { some: { updatedAt: { gte: since } } } } } },
        ],
      },
      select: {
        confirmationCode: true,
        totalAmount: true,
        event: { select: { billingMode: true } },
        payments: {
          where: { status: "SUCCEEDED" },
          select: { amount: true, refunds: { where: { status: "SUCCEEDED" }, select: { amount: true } } },
        },
      },
      orderBy: { id: "asc" },
      take: LIVE_CHANGES_LIMIT + 1,
    }),
  ]);
  // One row past the limit means the answer is incomplete: say so, and the
  // client reloads the roster instead of showing a partial list.
  const truncated = rows.length > LIVE_CHANGES_LIMIT || moneyRows.length > LIVE_CHANGES_LIMIT;
  const changes = collapseCheckInChanges(rows.length > LIVE_CHANGES_LIMIT ? rows.slice(0, LIVE_CHANGES_LIMIT) : rows);
  const balances: LiveBalanceChange[] = (moneyRows.length > LIVE_CHANGES_LIMIT ? moneyRows.slice(0, LIVE_CHANGES_LIMIT) : moneyRows)
    .map((registration) => [registration.confirmationCode, liveRegistrationBalanceCents(registration)] as const);
  return truncated
    ? { now: now.toISOString(), changes, balances, truncated: true }
    : { now: now.toISOString(), changes, balances };
}
