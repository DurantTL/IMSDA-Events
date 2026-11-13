import "server-only";

import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { formatPersonName } from "@/lib/person-name";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { loadEventLedger } from "@/modules/invoices/ledger-repository";
import { listRegistrations } from "@/modules/registrations/repository";
import { listUnmatchedSquarePayments } from "@/modules/payments/square-match-repository";
import { isExpectedUnavailable, squareTimeoutMs, withTimeout } from "@/modules/payments/money-tools-repository";
import {
  buildMoneyReport,
  type MoneyMethod,
  type MoneyReport,
  type MoneyReportRegistration,
  type StatusTally,
} from "@/modules/payments/event-money-report-domain";

/**
 * The Event money report (#1962) for one event. Reads only: registrations through the existing balance code
 * (`listRegistrations`), payments, refunds, promo code redemptions, adjustments and church invoices. The shadow ledger
 * is not read. The caller has already checked MANAGE_FINANCE or VIEW_REPORTS.
 */

/** The same rounding the registration balance code uses (`serializeRegistration`). */
const cents = (value: { toString(): string } | number) => Math.round(Number(value) * 100);

const emptyTally = (): StatusTally => ({ count: 0, cents: 0 });
const emptyMethods = (): Record<MoneyMethod, number> => ({ CARD_REFERENCE: 0, CASH: 0, CHECK: 0, MANUAL: 0 });

export type MoneyReportRow = MoneyReportRegistration & { accountHolderName: string };
export type EventMoneyReport = { eventName: string; report: Omit<MoneyReport, "owing"> & { owing: MoneyReportRow[] } };

export async function loadEventMoneyReport(eventId: string): Promise<EventMoneyReport> {
  const prisma = getPrisma();
  const [event, registrations, payments, adjustments, redemptions, ledger] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { name: true } }),
    listRegistrations(eventId),
    prisma.payment.findMany({
      where: { eventId },
      select: { registrationId: true, status: true, method: true, amount: true, refunds: { select: { status: true, amount: true } } },
    }),
    prisma.registrationAdjustment.findMany({
      where: { eventId, kind: { in: ["SCHOLARSHIP", "DISCOUNT", "PROMO_CODE"] } },
      select: { registrationId: true, kind: true, amountCents: true },
    }),
    prisma.promoCodeRedemption.findMany({ where: { eventId }, select: { registrationId: true, discountAmountCents: true } }),
    loadEventLedger(eventId),
  ]);

  const gross = new Map<string, Record<MoneyMethod, number>>();
  const refunded = new Map<string, number>();
  const uncountedPayments = { PENDING: emptyTally(), FAILED: emptyTally(), VOIDED: emptyTally() };
  const uncountedRefunds = { PENDING: emptyTally(), FAILED: emptyTally() };
  for (const payment of payments) {
    if (payment.status === "SUCCEEDED") {
      const methods = gross.get(payment.registrationId) ?? emptyMethods();
      methods[payment.method] += cents(payment.amount);
      gross.set(payment.registrationId, methods);
      for (const refund of payment.refunds) {
        if (refund.status === "SUCCEEDED") refunded.set(payment.registrationId, (refunded.get(payment.registrationId) ?? 0) + cents(refund.amount));
      }
    } else if (payment.status in uncountedPayments) {
      const tally = uncountedPayments[payment.status as keyof typeof uncountedPayments];
      tally.count += 1;
      tally.cents += cents(payment.amount);
    }
    for (const refund of payment.refunds) {
      if (refund.status === "PENDING" || refund.status === "FAILED") {
        uncountedRefunds[refund.status].count += 1;
        uncountedRefunds[refund.status].cents += cents(refund.amount);
      }
    }
  }
  const reductions = new Map<string, { promo: number; discount: number; scholarship: number }>();
  const reduction = (registrationId: string) => {
    const existing = reductions.get(registrationId) ?? { promo: 0, discount: 0, scholarship: 0 };
    reductions.set(registrationId, existing);
    return existing;
  };
  for (const adjustment of adjustments) {
    const entry = reduction(adjustment.registrationId);
    if (adjustment.kind === "PROMO_CODE") entry.promo -= adjustment.amountCents;
    else if (adjustment.kind === "DISCOUNT") entry.discount -= adjustment.amountCents;
    else entry.scholarship -= adjustment.amountCents;
  }
  for (const redemption of redemptions) reduction(redemption.registrationId).promo += redemption.discountAmountCents;

  const holderNames = new Map<string, string>();
  const rows: MoneyReportRegistration[] = registrations.map((registration) => {
    holderNames.set(registration.id, formatPersonName(registration.accountHolder));
    const own = reductions.get(registration.id);
    return {
      id: registration.id,
      confirmationCode: registration.confirmationCode,
      status: registration.status,
      churchBilled: registration.isDeferredOrganizationBilling,
      totalAmountCents: registration.totalAmountCents,
      paidCents: registration.paidCents,
      balanceCents: registration.balanceCents,
      grossPaidByMethod: gross.get(registration.id) ?? emptyMethods(),
      refundedCents: refunded.get(registration.id) ?? 0,
      promoReductionCents: own?.promo ?? 0,
      discountReductionCents: own?.discount ?? 0,
      scholarshipReductionCents: own?.scholarship ?? 0,
    };
  });

  const report = buildMoneyReport({
    registrations: rows,
    uncountedPayments,
    uncountedRefunds,
    churchInvoices: {
      invoiceCount: ledger.length,
      invoicedCents: ledger.reduce((total, invoice) => total + invoice.figures.amountDueCents, 0),
      receivedCents: ledger.reduce((total, invoice) => total + invoice.figures.paidCents, 0),
      stillOwedCents: ledger.reduce((total, invoice) => total + invoice.figures.outstandingCents, 0),
      overpaidCents: ledger.reduce((total, invoice) => total + invoice.figures.overpaidCents, 0),
    },
  });
  return {
    eventName: event?.name ?? "",
    report: { ...report, owing: report.owing.map((row) => ({ ...row, accountHolderName: holderNames.get(row.id) ?? "" })) },
  };
}

export type UnmatchedSquareSummary =
  | { state: "ok"; count: number; cents: number }
  /** Square is not set up on this site: not an outage. */
  | { state: "notConfigured" }
  /** Square could not be read in time (or at all). Never shown as zero. */
  | { state: "unavailable" };

/**
 * Square payments not matched to a registration of this event. Always scoped to this event, for every viewer: payments
 * that name no registration are never included here (the match tool lists them for system administrators).
 */
export async function loadUnmatchedSquareSummary(eventId: string): Promise<UnmatchedSquareSummary> {
  try {
    return await withTimeout(async () => {
      const { findings, unreachableSquare } = await listUnmatchedSquarePayments({ eventId, includeUnattributed: false });
      if (unreachableSquare) throw new Error("Square could not be reached");
      return { state: "ok" as const, count: findings.length, cents: findings.reduce((total, finding) => total + finding.amountCents, 0) };
    }, squareTimeoutMs);
  } catch (error) {
    if (isExpectedUnavailable(error)) return { state: "notConfigured" };
    logError("Event money report: Square payments could not load", error);
    return { state: "unavailable" };
  }
}

/** The CSV's data, audited with counts only. */
export async function exportEventMoneyReport(eventId: string, actorUserId: string) {
  const data = await loadEventMoneyReport(eventId);
  await writeAuditLog({
    eventId,
    actorUserId,
    action: "EVENT_MONEY_REPORT_EXPORTED",
    entityType: "EventMoneyReport",
    summary: "Exported the event money report.",
    metadata: { owingRegistrations: data.report.owing.length, outstandingCents: data.report.outstandingCents, checkOk: data.report.check.ok },
  });
  return data;
}
