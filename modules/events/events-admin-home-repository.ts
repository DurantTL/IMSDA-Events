import "server-only";

import { getPrisma } from "@/lib/prisma";
import { findDashboardEvents, moneyToCents, toDashboardEventSource } from "@/modules/system-admin/repository";
import { failedEmailWheres } from "@/modules/system-admin/email-problem-filters";
import { EMAIL_PROBLEM_WINDOW_DAYS } from "@/modules/system-admin/attention-model";
import type { EventsAdminEventSource } from "@/modules/events/events-admin-home-model";
import { registrationBalance } from "@/modules/system-admin/dashboard";

/**
 * The Events Administrator dashboard's read (#1227). `eventIds` must come from `resolveAdminRoles(user).eventAdminEventIds`
 * on the server: only those events are read, archived and ended events are left out in the query, and an empty list
 * runs no query at all. Read-only.
 */
export async function getEventsAdminEventSources(eventIds: readonly string[], now = new Date()): Promise<EventsAdminEventSource[]> {
  const prisma = getPrisma();
  const rows = await findDashboardEvents(prisma, { eventIds, endsOnOrAfter: now });
  if (rows.length === 0) return [];
  // Billing mode and draft registrations, for exactly the events the shared read returned.
  const extras = await prisma.event.findMany({
    where: { id: { in: rows.map((row) => row.id) }, archivedAt: null },
    select: {
      id: true,
      billingMode: true,
      _count: { select: { registrations: { where: { status: "DRAFT" } } } },
    },
  });
  const byId = new Map(extras.map((extra) => [extra.id, extra]));
  // Failed messages: the System attention rule (last 7 days, not later resent), only for the returned events.
  const since = new Date(now.getTime() - EMAIL_PROBLEM_WINDOW_DAYS * 24 * 60 * 60_000);
  const [failedWhere, providerWhere] = failedEmailWheres(since, rows.map((row) => row.id));
  const [failed, providerProblems] = await Promise.all([
    prisma.messageOutbox.groupBy({ by: ["eventId"], where: failedWhere, _count: { _all: true } }),
    prisma.messageOutbox.groupBy({ by: ["eventId"], where: providerWhere, _count: { _all: true } }),
  ]);
  const failedByEvent = new Map<string, number>();
  for (const group of [...failed, ...providerProblems]) {
    if (group.eventId) failedByEvent.set(group.eventId, (failedByEvent.get(group.eventId) ?? 0) + group._count._all);
  }
  return rows.map((row) => ({
    ...toDashboardEventSource(row),
    billingMode: byId.get(row.id)?.billingMode ?? "ATTENDEE_PAY",
    draftRegistrationCount: byId.get(row.id)?._count.registrations ?? 0,
    failedEmailCount: failedByEvent.get(row.id) ?? 0,
  }));
}

/**
 * What the Events Administrator pill counts (#1245): the dashboard's "Need attention" total (open balances plus draft
 * registrations), read with two small queries instead of the whole dashboard read, since the shell runs it on every
 * page. Same scope as `getEventsAdminEventSources` and `buildEventsAdminHome`: only `eventIds` (the signed-in person's
 * own `resolveAdminRoles(user).eventAdminEventIds`), not archived, not ended; open balances exclude events billed to
 * churches; the balance rule is `registrationBalance`. Callers leave the count off when this throws, never show zero.
 */
export async function countEventsAdminWaiting(eventIds: readonly string[], now = new Date()): Promise<number> {
  if (eventIds.length === 0) return 0;
  const prisma = getPrisma();
  const scope = { id: { in: [...eventIds] }, archivedAt: null, endsAt: { gte: now } };
  const [drafts, registrations] = await Promise.all([
    prisma.registration.count({ where: { status: "DRAFT", event: scope } }),
    prisma.registration.findMany({
      where: { status: { in: ["SUBMITTED", "CONFIRMED"] }, event: { ...scope, billingMode: { not: "DEFERRED_ORGANIZATION_INVOICE" } } },
      select: {
        totalAmount: true,
        payments: { where: { status: "SUCCEEDED" }, select: { amount: true, refunds: { where: { status: "SUCCEEDED" }, select: { amount: true } } } },
      },
    }),
  ]);
  const open = registrations.filter((registration) => registrationBalance({
    status: "CONFIRMED",
    totalAmountCents: moneyToCents(registration.totalAmount),
    payments: registration.payments.map((payment) => ({
      amountCents: moneyToCents(payment.amount),
      refunds: payment.refunds.map((refund) => ({ amountCents: moneyToCents(refund.amount) })),
    })),
  }) > 0).length;
  return open + drafts;
}
