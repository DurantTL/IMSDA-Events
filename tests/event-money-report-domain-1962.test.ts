import { describe, expect, it } from "vitest";
import { buildMoneyReport, moneyReportCsvRows, type MoneyMethod, type MoneyReportRegistration } from "@/modules/payments/event-money-report-domain";
import { toCsv } from "@/modules/reporting/csv";

const methods = (partial: Partial<Record<MoneyMethod, number>> = {}) => ({ CARD_REFERENCE: 0, CASH: 0, CHECK: 0, MANUAL: 0, ...partial });
const tally = () => ({ count: 0, cents: 0 });
const extras = {
  uncountedPayments: { PENDING: tally(), FAILED: tally(), VOIDED: tally() },
  uncountedRefunds: { PENDING: tally(), FAILED: tally() },
  churchInvoices: { invoiceCount: 0, invoicedCents: 0, receivedCents: 0, stillOwedCents: 0, overpaidCents: 0 },
};

/** The same arithmetic as the registration balance code: paid = payments - refunds, balance = max(total - paid, 0). */
function row(id: string, over: Partial<MoneyReportRegistration> & { gross?: Partial<Record<MoneyMethod, number>> } = {}): MoneyReportRegistration {
  const grossPaidByMethod = methods(over.gross);
  const gross = Object.values(grossPaidByMethod).reduce((a, b) => a + b, 0);
  const refundedCents = over.refundedCents ?? 0;
  const totalAmountCents = over.totalAmountCents ?? 10_000;
  return {
    id,
    confirmationCode: `SYN-${id}`,
    status: "CONFIRMED",
    churchBilled: false,
    totalAmountCents,
    paidCents: gross - refundedCents,
    balanceCents: Math.max(totalAmountCents - (gross - refundedCents), 0),
    grossPaidByMethod,
    refundedCents,
    promoReductionCents: 0,
    discountReductionCents: 0,
    scholarshipReductionCents: 0,
    ...over,
  };
}

describe("event money report (#1962)", () => {
  it("adds up exactly with overpaid, church-billed and inactive registrations", () => {
    const report = buildMoneyReport({
      ...extras,
      registrations: [
        row("a", { gross: { CARD_REFERENCE: 6000 }, discountReductionCents: 1000 }),
        row("b", { totalAmountCents: 5000, gross: { CHECK: 8000 }, refundedCents: 1000 }),
        row("c", { status: "CANCELLED", gross: { CASH: 10_000 }, refundedCents: 10_000 }),
        row("d", { status: "WAITLISTED", gross: { CASH: 2000 } }),
        row("e", { churchBilled: true, totalAmountCents: 50_000, gross: { CARD_REFERENCE: 10_000 } }),
      ],
    });
    expect(report.charges.netDueCents).toBe(10_000 + 5000 + 50_000);
    expect(report.charges.grossCents).toBe(report.charges.netDueCents + 1000);
    expect(report.outstandingCents).toBe(4000);
    expect(report.overpaidCreditCents).toBe(2000);
    // 15,000 due - 14,000 paid + 1,000 refunded + 2,000 overpaid credit = 4,000 outstanding.
    expect(report.reconciliation.map((line) => line.cents)).toEqual([15_000, 14_000, 1000, 2000, 4000]);
    expect(report.churchBilled.estimatedCents).toBe(50_000);
    expect(report.churchBilled.attendeePaymentsNetCents).toBe(10_000);
    expect(report.notActive).toEqual({ registrationCount: 2, paymentsCents: 12_000, refundsCents: 10_000 });
    expect(report.paid.totalCents).toBe(36_000);
    expect(report.refundsCents).toBe(11_000);
    expect(report.check.ok).toBe(true);
    expect(report.owing.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("never lists church-billed or inactive registrations as owing", () => {
    const report = buildMoneyReport({
      ...extras,
      registrations: [row("a", { churchBilled: true }), row("b", { status: "CANCELLED" }), row("c", { status: "DRAFT" }), row("d")],
    });
    expect(report.owing.map((entry) => entry.id)).toEqual(["d"]);
    expect(report.outstandingCents).toBe(10_000);
  });

  it("fails the check when a registration's paid amount disagrees with its payments", () => {
    const bad = { ...row("a", { gross: { CASH: 5000 } }), paidCents: 4000 };
    expect(buildMoneyReport({ ...extras, registrations: [bad] }).check.everyRegistrationPaidMatches).toBe(false);
  });

  it("is zero for an event with no registrations", () => {
    const report = buildMoneyReport({ ...extras, registrations: [] });
    expect(report.outstandingCents).toBe(0);
    expect(report.check.ok).toBe(true);
  });

  it("keeps the minus sign on a negative figure and uses the shared status words", () => {
    // A registration paid more than it owes and then had its total lowered: the reconciliation still shows signed figures.
    const report = buildMoneyReport({ ...extras, registrations: [row("a", { totalAmountCents: -500, status: "SUBMITTED" }), row("b", { status: "SUBMITTED" })] });
    const rows = moneyReportCsvRows("Test Event", report, "note");
    expect(rows.find((line) => line[0] === "Net due")?.[1]).toBe(95);
    expect(rows.find((line) => line[0] === "Paid: total")?.[1]).toBe(0);
    const csv = toCsv(rows);
    expect(csv).toContain('"SYN-b","Submitted","100","0","100"');
    // The reconciliation of a lone negative-total registration: credit is shown signed where a figure is negative.
    const negative = moneyReportCsvRows("Test Event", buildMoneyReport({ ...extras, registrations: [row("a", { totalAmountCents: -500, status: "SUBMITTED" })] }), "note");
    expect(negative.find((line) => line[0] === "Net due")?.[1]).toBe(-5);
    expect(toCsv(negative)).toContain('"Net due","-5",');
        expect(csv).not.toContain("SUBMITTED");
  });

  it("describes gross charges as an estimate outside the reconciliation", () => {
    const rows = moneyReportCsvRows("Test Event", buildMoneyReport({ ...extras, registrations: [] }), "note");
    expect(String(rows.find((line) => line[0] === "Gross charges")?.[2])).toContain("An estimate, not part of the reconciliation");
  });

  it("writes a formula-safe CSV with codes and amounts only", () => {
    const report = buildMoneyReport({ ...extras, registrations: [row("a", { confirmationCode: "=SUM(1)" })] });
    const csv = toCsv(moneyReportCsvRows("Test Event", report, "note"));
    expect(csv).toContain("\"'=SUM(1)\"");
    expect(csv).toContain("Outstanding balance");
    // Only the deliberately hostile confirmation code is guarded; no label or amount starts like a formula.
    expect(csv.match(/"'[+=@-]/g)).toHaveLength(1);
    expect(csv).toContain("\"Payments received on them\",\"0\",\"minus\"");
  });
});
