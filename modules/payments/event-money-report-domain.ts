import { registrationStatusWordOrRaw } from "@/modules/registrations/status-words";
import { activeFinancialStatuses, attendeeBalanceCents, summarizeFinanceTotals } from "@/modules/registrations/finance-view";

/**
 * The Event money report (#1962), pure rules. A lean view built only from the payment, refund, discount, adjustment and
 * invoice records the site already keeps. It never reads or writes the shadow ledger and changes no balance: the
 * per-registration balance, the church-billed rule and the totals come from the existing registration code
 * (`serializeRegistration`, `attendeeBalanceCents`, `summarizeFinanceTotals`), and this module only adds them up and
 * labels every line so the report adds up exactly.
 *
 * Definitions (every figure is whole cents, for one event):
 * - Active registration: status SUBMITTED or CONFIRMED (`activeFinancialStatuses`). Draft, waitlisted and cancelled
 *   registrations are never counted as owing.
 * - Net due: the sum of `Registration.totalAmount` over active registrations. That total is already the priced total
 *   plus every adjustment line (scholarship, discount, promo code, correction, meal, asset; signed, reversals pointing
 *   at originals) and minus the registration-level promo code discount.
 * - Reductions: promo codes (the registration-level redemption plus per-person PROMO_CODE adjustments), discounts
 *   (DISCOUNT adjustments) and scholarships (SCHOLARSHIP adjustments), each net of reversals, over active
 *   registrations. Positive lowers what is owed.
 * - Gross charges: net due plus those reductions, rebuilt from the recorded discounts. It is an estimate and takes no
 *   part in the reconciliation. Corrections, meal and asset lines stay inside it.
 * - Church-billed: an active registration of a church-billed (deferred organization invoice) event. Its total is
 *   what the church owes after the event; it is never an attendee balance and is listed on its own line.
 * - Paid: gross SUCCEEDED payments, by method. Refunds: SUCCEEDED refunds of SUCCEEDED payments. Pending, failed and
 *   voided payments and pending or failed refunds count in no total and are listed apart.
 * - Outstanding: what the existing balance code gives: per registration `max(total - (paid - refunds), 0)`, zero for
 *   church-billed, active registrations only.
 *
 * Reconciliation (exact, by construction of the per-registration clamp `max(x, 0) = x + max(-x, 0)`):
 *   outstanding = attendee-billed net due - payments received + refunds + overpaid credit
 * over active registrations that are not church-billed, where overpaid credit is what registrations paid beyond
 * what they owe (it is not netted against anyone else's balance). Money on church-billed registrations and on
 * registrations that are not active sits on its own labelled lines, so event-wide payments and refunds still add up.
 */

export const moneyMethods = ["CARD_REFERENCE", "CASH", "CHECK", "MANUAL"] as const;
export type MoneyMethod = (typeof moneyMethods)[number];

export const moneyMethodLabels: Record<MoneyMethod, string> = {
  CARD_REFERENCE: "Square card",
  CASH: "Cash",
  CHECK: "Check",
  MANUAL: "Other recorded payment",
};

export type MoneyReportRegistration = {
  id: string;
  confirmationCode: string;
  status: string;
  churchBilled: boolean;
  /** From the existing registration balance code (`listRegistrations`). */
  totalAmountCents: number;
  paidCents: number;
  balanceCents: number;
  /** SUCCEEDED payments by method, before refunds. */
  grossPaidByMethod: Record<MoneyMethod, number>;
  /** SUCCEEDED refunds of SUCCEEDED payments. */
  refundedCents: number;
  /** Net reductions already inside `totalAmountCents`, positive lowers what is owed. */
  promoReductionCents: number;
  discountReductionCents: number;
  scholarshipReductionCents: number;
};

export type StatusTally = { count: number; cents: number };

export type MoneyReportInput = {
  registrations: readonly MoneyReportRegistration[];
  /** Payments that are not counted as paid, by status. */
  uncountedPayments: { PENDING: StatusTally; FAILED: StatusTally; VOIDED: StatusTally };
  uncountedRefunds: { PENDING: StatusTally; FAILED: StatusTally };
  /** Church invoices of the event, from the existing invoice arithmetic (`outstandingFigures`). */
  churchInvoices: { invoiceCount: number; invoicedCents: number; receivedCents: number; stillOwedCents: number; overpaidCents: number };
};

export type ReconciliationLine = { key: string; label: string; cents: number; sign: "+" | "-" | "=" };

export type MoneyReport = {
  charges: { grossCents: number; promoCents: number; discountCents: number; scholarshipCents: number; netDueCents: number };
  paid: { byMethod: Record<MoneyMethod, number>; totalCents: number };
  refundsCents: number;
  uncountedPayments: MoneyReportInput["uncountedPayments"];
  uncountedRefunds: MoneyReportInput["uncountedRefunds"];
  outstandingCents: number;
  /** Active, attendee-billed registrations with a balance, largest first. */
  owing: MoneyReportRegistration[];
  churchBilled: { registrationCount: number; estimatedCents: number; attendeePaymentsNetCents: number; invoices: MoneyReportInput["churchInvoices"] };
  notActive: { registrationCount: number; paymentsCents: number; refundsCents: number };
  overpaidCreditCents: number;
  /** Net due minus payments plus refunds plus overpaid credit, over attendee-billed active registrations. */
  reconciliation: ReconciliationLine[];
  check: {
    /** The reconciliation's last line equals the existing balance code's outstanding, summed two ways. */
    outstandingMatches: boolean;
    /** Payments by method add up to the payments of all registrations, and refunds do too. */
    paymentLinesAddUp: boolean;
    /** Each registration's own gross payments less refunds equals the paid amount the balance code uses. */
    everyRegistrationPaidMatches: boolean;
    ok: boolean;
  };
};

const zeroMethods = (): Record<MoneyMethod, number> => ({ CARD_REFERENCE: 0, CASH: 0, CHECK: 0, MANUAL: 0 });
const sum = <T,>(rows: readonly T[], pick: (row: T) => number) => rows.reduce((total, row) => total + pick(row), 0);
const grossPaid = (row: MoneyReportRegistration) => sum(moneyMethods, (method) => row.grossPaidByMethod[method]);

export function buildMoneyReport(input: MoneyReportInput): MoneyReport {
  const rows = input.registrations;
  const active = rows.filter((row) => activeFinancialStatuses.has(row.status));
  const attendeeBilled = active.filter((row) => !row.churchBilled);
  const churchBilledRows = active.filter((row) => row.churchBilled);
  const notActive = rows.filter((row) => !activeFinancialStatuses.has(row.status));

  const netDueCents = sum(active, (row) => row.totalAmountCents);
  const promoCents = sum(active, (row) => row.promoReductionCents);
  const discountCents = sum(active, (row) => row.discountReductionCents);
  const scholarshipCents = sum(active, (row) => row.scholarshipReductionCents);

  const byMethod = zeroMethods();
  for (const row of rows) for (const method of moneyMethods) byMethod[method] += row.grossPaidByMethod[method];
  const totalPaid = sum(moneyMethods, (method) => byMethod[method]);
  const refundsCents = sum(rows, (row) => row.refundedCents);

  // The existing finance rules, run over the same rows.
  const existing = summarizeFinanceTotals(rows.map((row) => ({
    status: row.status,
    totalAmountCents: row.totalAmountCents,
    paidCents: row.paidCents,
    balanceCents: row.balanceCents,
    isDeferredOrganizationBilling: row.churchBilled,
    payments: [{ refundedCents: row.refundedCents }],
  })));
  const owing = attendeeBilled
    .filter((row) => attendeeBalanceCents({ balanceCents: row.balanceCents, isDeferredOrganizationBilling: row.churchBilled }) > 0)
    .sort((a, b) => b.balanceCents - a.balanceCents || a.confirmationCode.localeCompare(b.confirmationCode));
  const outstandingCents = sum(owing, (row) => row.balanceCents);

  const attendeeNetDueCents = sum(attendeeBilled, (row) => row.totalAmountCents);
  const attendeePaid = sum(attendeeBilled, grossPaid);
  const attendeeRefunds = sum(attendeeBilled, (row) => row.refundedCents);
  const overpaidCreditCents = sum(attendeeBilled, (row) => Math.max(grossPaid(row) - row.refundedCents - row.totalAmountCents, 0));
  const reconciled = attendeeNetDueCents - attendeePaid + attendeeRefunds + overpaidCreditCents;

  const reconciliation: ReconciliationLine[] = [
    { key: "attendeeNetDue", label: "Net due, attendee-billed active registrations", cents: attendeeNetDueCents, sign: "+" },
    { key: "paymentsReceived", label: "Payments received on them", cents: attendeePaid, sign: "-" },
    { key: "refunds", label: "Refunds paid back on them", cents: attendeeRefunds, sign: "+" },
    { key: "overpaidCredit", label: "Overpaid credit (paid more than owed; never netted against another registration)", cents: overpaidCreditCents, sign: "+" },
    { key: "outstanding", label: "Outstanding balance", cents: reconciled, sign: "=" },
  ];

  const notActivePayments = sum(notActive, grossPaid);
  const notActiveRefunds = sum(notActive, (row) => row.refundedCents);
  const churchPayments = sum(churchBilledRows, grossPaid);
  const churchRefunds = sum(churchBilledRows, (row) => row.refundedCents);

  const paymentLinesAddUp = totalPaid === attendeePaid + churchPayments + notActivePayments
    && refundsCents === attendeeRefunds + churchRefunds + notActiveRefunds;
  const outstandingMatches = reconciled === outstandingCents && outstandingCents === existing.outstanding;
  const everyRegistrationPaidMatches = rows.every((row) => grossPaid(row) - row.refundedCents === row.paidCents);

  return {
    charges: { grossCents: netDueCents + promoCents + discountCents + scholarshipCents, promoCents, discountCents, scholarshipCents, netDueCents },
    paid: { byMethod, totalCents: totalPaid },
    refundsCents,
    uncountedPayments: input.uncountedPayments,
    uncountedRefunds: input.uncountedRefunds,
    outstandingCents,
    owing,
    churchBilled: {
      registrationCount: churchBilledRows.length,
      estimatedCents: existing.churchBilled,
      attendeePaymentsNetCents: churchPayments - churchRefunds,
      invoices: input.churchInvoices,
    },
    notActive: { registrationCount: notActive.length, paymentsCents: notActivePayments, refundsCents: notActiveRefunds },
    overpaidCreditCents,
    reconciliation,
    check: {
      outstandingMatches,
      paymentLinesAddUp,
      everyRegistrationPaidMatches,
      ok: outstandingMatches && paymentLinesAddUp && everyRegistrationPaidMatches,
    },
  };
}

/** Signed dollars as a number: `csvCell` leaves a finite number alone, so a negative figure stays a number and is not read as a formula. */
function dollars(cents: number) {
  return Math.round(cents) / 100;
}

/**
 * The CSV: figures with what each includes, the reconciliation, then one row per registration that owes. Confirmation
 * codes and amounts only: no names, contact details, birth dates or health information.
 */
export function moneyReportCsvRows(eventName: string, report: MoneyReport, rangeNote: string): Array<Array<string | number>> {
  const { charges, paid } = report;
  return [
    ["Event money report", eventName],
    ["Note", rangeNote],
    [],
    ["Figure", "Amount", "What it includes"],
    ["Gross charges", dollars(charges.grossCents), "An estimate, not part of the reconciliation: net due plus the promo code discounts, discounts and scholarships recorded on active (submitted or confirmed) registrations. Corrections, meal and asset lines stay inside."],
    ["Promo code discounts", dollars(charges.promoCents), "Registration-level promo code discount plus per-person promo code adjustments, net of reversals."],
    ["Discounts", dollars(charges.discountCents), "Discount adjustments, net of reversals."],
    ["Scholarships", dollars(charges.scholarshipCents), "Scholarship adjustments, net of reversals (pledged and funded)."],
    ["Net due", dollars(charges.netDueCents), "Registration totals of active registrations, including church-billed ones."],
    ...moneyMethods.map((method): Array<string | number> => [`Paid: ${moneyMethodLabels[method]}`, dollars(paid.byMethod[method]), "Successful payments, before refunds, on any registration of this event."]),
    ["Paid: total", dollars(paid.totalCents), "All successful payments, before refunds."],
    ["Refunds", dollars(report.refundsCents), "Successful refunds of successful payments."],
    ["Outstanding balance", dollars(report.outstandingCents), "What attendee-billed active registrations still owe. Church-billed registrations are never counted here."],
    ["Church-billed estimate", dollars(report.churchBilled.estimatedCents), `${report.churchBilled.registrationCount} church-billed active registrations; billed to the church after the event.`],
    ["Church invoices: invoiced", dollars(report.churchBilled.invoices.invoicedCents), `${report.churchBilled.invoices.invoiceCount} finalized invoices.`],
    ["Church invoices: received", dollars(report.churchBilled.invoices.receivedCents), "Invoice payments less voided payments."],
    ["Church invoices: still owed", dollars(report.churchBilled.invoices.stillOwedCents), "Per invoice, never below zero."],
    ["Pending payments", dollars(report.uncountedPayments.PENDING.cents), `${report.uncountedPayments.PENDING.count} payments; not counted as paid.`],
    ["Failed payments", dollars(report.uncountedPayments.FAILED.cents), `${report.uncountedPayments.FAILED.count} payments; not counted as paid.`],
    ["Voided payments", dollars(report.uncountedPayments.VOIDED.cents), `${report.uncountedPayments.VOIDED.count} payments; not counted as paid.`],
    ["Pending refunds", dollars(report.uncountedRefunds.PENDING.cents), `${report.uncountedRefunds.PENDING.count} refunds; not counted.`],
    ["Failed refunds", dollars(report.uncountedRefunds.FAILED.cents), `${report.uncountedRefunds.FAILED.count} refunds; not counted.`],
    [],
    ["Reconciliation", "Amount", "Operation"],
    ...report.reconciliation.map((line): Array<string | number> => [line.label, dollars(line.cents), line.sign === "+" ? "plus" : line.sign === "-" ? "minus" : "equals"]),
    ["Check", report.check.ok ? "Adds up" : "DOES NOT ADD UP"],
    [],
    ["Registrations that owe", "Status", "Net due", "Paid (net of refunds)", "Balance"],
    ...report.owing.map((row): Array<string | number> => [row.confirmationCode, registrationStatusWordOrRaw(row.status), dollars(row.totalAmountCents), dollars(row.paidCents), dollars(row.balanceCents)]),
  ];
}
