/**
 * Proves the Event money report (#1962) against a real PostgreSQL database:
 *
 * - for EVERY event in the database (the seeded ones included) the report's labelled lines add up exactly, the outstanding
 *   balance equals the existing balance code (`listRegistrations` per registration, `summarizeFinanceTotals` in total),
 *   and payments by method add up to all successful payments;
 * - for a synthetic event with card, cash and check payments, a refund, an overpaid registration, failed, pending and
 *   voided payments, a pending refund, discount and scholarship lines, a cancelled and a waitlisted registration, and a
 *   church-billed twin event, the figures are exactly the ones worked out by hand below;
 * - the CSV holds confirmation codes and amounts and no name or contact detail.
 *
 * Uses fictitious rows it creates and removes itself. Square is not called.
 *
 *   npm run test:event-money-report
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { toCsv } from "../modules/reporting/csv";
import { moneyReportCsvRows } from "../modules/payments/event-money-report-domain";
import { loadEventMoneyReport } from "../modules/payments/event-money-report-repository";
import { listRegistrations } from "../modules/registrations/repository";
import { attendeeBalanceCents, summarizeFinanceTotals } from "../modules/registrations/finance-view";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");

const prisma = new PrismaClient();
const P = `emr1962_${randomUUID().slice(0, 8)}`;
const person = `${P}_person`;
const startsWithP = { startsWith: P };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function cleanup() {
  await prisma.event.deleteMany({ where: { id: startsWithP } });
  await prisma.registration.deleteMany({ where: { eventId: startsWithP } });
  await prisma.person.deleteMany({ where: { id: startsWithP } });
}

let counter = 0;
async function mkEvent(billingMode: "ATTENDEE_PAY" | "DEFERRED_ORGANIZATION_INVOICE") {
  counter += 1;
  const id = `${P}_event_${counter}`;
  const day = 86_400_000;
  await prisma.event.create({
    data: { id, slug: `${id.replace(/_/g, "-")}-slug`, name: `Money Report Check Event ${counter}`, startsAt: new Date(Date.now() + day), endsAt: new Date(Date.now() + 2 * day), isPublished: false, audience: "GENERAL", billingMode },
  });
  return id;
}

async function mkRegistration(eventId: string, code: string, status: "SUBMITTED" | "CONFIRMED" | "CANCELLED" | "WAITLISTED", totalDollars: number) {
  return prisma.registration.create({
    data: { eventId, accountHolderPersonId: person, confirmationCode: code, status, totalAmount: totalDollars },
    select: { id: true },
  });
}

async function pay(eventId: string, registrationId: string, amount: number, method: "CARD_REFERENCE" | "CASH" | "CHECK" | "MANUAL", status: "SUCCEEDED" | "PENDING" | "FAILED" | "VOIDED" = "SUCCEEDED") {
  return prisma.payment.create({ data: { eventId, registrationId, amount, method, status }, select: { id: true } });
}

const refund = (eventId: string, paymentId: string, amount: number, status: "SUCCEEDED" | "PENDING" | "FAILED") =>
  prisma.refund.create({ data: { eventId, paymentId, amount, status } });

/** Every property of the report the issue promises, checked against the existing balance code for one event. */
async function checkAgainstExistingBalances(eventId: string, label: string) {
  const { report } = await loadEventMoneyReport(eventId);
  assert(report.check.ok, `${label}: the report's own check failed ${JSON.stringify(report.check)}`);
  const last = report.reconciliation[report.reconciliation.length - 1]!;
  assert(last.cents === report.outstandingCents, `${label}: reconciliation ends at ${last.cents}, outstanding is ${report.outstandingCents}`);
  const registrations = await listRegistrations(eventId);
  const totals = summarizeFinanceTotals(registrations.map((registration) => ({
    status: registration.status,
    totalAmountCents: registration.totalAmountCents,
    paidCents: registration.paidCents,
    balanceCents: registration.balanceCents,
    isDeferredOrganizationBilling: registration.isDeferredOrganizationBilling,
    payments: [{ refundedCents: 0 }],
  })));
  assert(totals.outstanding === report.outstandingCents, `${label}: outstanding ${report.outstandingCents} differs from the finance totals ${totals.outstanding}`);
  assert(totals.churchBilled === report.churchBilled.estimatedCents, `${label}: church-billed differs`);
  const owing = new Map(report.owing.map((row) => [row.id, row.balanceCents]));
  for (const registration of registrations) {
    const active = registration.status === "SUBMITTED" || registration.status === "CONFIRMED";
    const expected = active ? attendeeBalanceCents(registration) : 0;
    assert((owing.get(registration.id) ?? 0) === expected, `${label}: registration ${registration.confirmationCode} balance ${owing.get(registration.id) ?? 0} differs from ${expected}`);
  }
  return report;
}

async function main() {
  await cleanup();
  try {
    // Every event already in the database, before the synthetic ones exist.
    const existing = await prisma.event.findMany({ select: { id: true, slug: true }, where: { NOT: { id: startsWithP } } });
    for (const event of existing) await checkAgainstExistingBalances(event.id, `event ${event.slug}`);
    console.log(`Checked ${existing.length} existing events`);

    await prisma.person.create({ data: { id: person, firstName: "Sample", lastName: "Registrant" } });

    // Event A, worked out by hand.
    const a = await mkEvent("ATTENDEE_PAY");
    const r1 = await mkRegistration(a, "EMR-1", "SUBMITTED", 70); // priced 100, discount 10, scholarship 20
    const r2 = await mkRegistration(a, "EMR-2", "CONFIRMED", 50);
    const r3 = await mkRegistration(a, "EMR-3", "CONFIRMED", 50);
    const r4 = await mkRegistration(a, "EMR-4", "CONFIRMED", 100);
    const r5 = await mkRegistration(a, "EMR-5", "CANCELLED", 100);
    const r6 = await mkRegistration(a, "EMR-6", "WAITLISTED", 20);
    for (const [kind, amountCents] of [["DISCOUNT", -1000], ["SCHOLARSHIP", -2000]] as const) {
      await prisma.registrationAdjustment.create({ data: { eventId: a, registrationId: r1.id, kind, amountCents, reason: "Synthetic adjustment", createdByNameSnapshot: "Synthetic" } });
    }
    await pay(a, r1.id, 30, "CARD_REFERENCE");
    await pay(a, r2.id, 50, "CASH");
    const overpaid = await pay(a, r3.id, 80, "CHECK");
    await refund(a, overpaid.id, 10, "SUCCEEDED");
    await pay(a, r4.id, 40, "CARD_REFERENCE", "FAILED");
    await pay(a, r4.id, 30, "CARD_REFERENCE", "PENDING");
    await pay(a, r4.id, 25, "CASH", "VOIDED");
    const r4Paid = await pay(a, r4.id, 0.01, "MANUAL");
    await refund(a, r4Paid.id, 0.01, "PENDING");
    const cancelled = await pay(a, r5.id, 100, "CARD_REFERENCE");
    await refund(a, cancelled.id, 100, "SUCCEEDED");
    await pay(a, r6.id, 20, "CASH");

    const report = await checkAgainstExistingBalances(a, "synthetic event A");
    const expect = (name: string, actual: number, wanted: number) => assert(actual === wanted, `${name}: ${actual} is not ${wanted}`);
    expect("net due", report.charges.netDueCents, 27_000); // 70 + 50 + 50 + 100
    expect("discounts", report.charges.discountCents, 1000);
    expect("scholarships", report.charges.scholarshipCents, 2000);
    expect("gross charges", report.charges.grossCents, 30_000);
    expect("paid card", report.paid.byMethod.CARD_REFERENCE, 3000 + 10_000); // R1 and the cancelled R5
    expect("paid total", report.paid.totalCents, 3000 + 5000 + 8000 + 1 + 10_000 + 2000); // R1, R2, R3, R4 manual, R5, R6
    expect("paid other", report.paid.byMethod.MANUAL, 1);
    expect("paid cash", report.paid.byMethod.CASH, 5000 + 2000);
    expect("paid check", report.paid.byMethod.CHECK, 8000);
    expect("refunds", report.refundsCents, 1000 + 10_000); // R3 and the cancelled R5
    expect("outstanding", report.outstandingCents, 4000 + 9999); // R1 70-30, R4 100-0.01
    expect("overpaid credit", report.overpaidCreditCents, 2000);
    expect("failed payments", report.uncountedPayments.FAILED.cents, 4000);
    expect("pending payments", report.uncountedPayments.PENDING.cents, 3000);
    expect("voided payments", report.uncountedPayments.VOIDED.cents, 2500);
    expect("pending refunds", report.uncountedRefunds.PENDING.cents, 1);
    expect("not active payments", report.notActive.paymentsCents, 12_000);
    assert(report.owing.length === 2 && report.owing[0]!.confirmationCode === "EMR-4", "owing lists the two registrations, largest first");

    // A church-billed event: its totals are never attendee outstanding.
    const b = await mkEvent("DEFERRED_ORGANIZATION_INVOICE");
    const c1 = await mkRegistration(b, "EMR-7", "SUBMITTED", 500);
    await pay(b, c1.id, 100, "CARD_REFERENCE");
    const church = await checkAgainstExistingBalances(b, "synthetic church-billed event");
    expect("church-billed estimate", church.churchBilled.estimatedCents, 50_000);
    expect("church outstanding", church.outstandingCents, 0);
    expect("church attendee payments", church.churchBilled.attendeePaymentsNetCents, 10_000);

    // The CSV: codes and amounts, no names or contact details.
    const csv = toCsv(moneyReportCsvRows("Money Report Check Event 1", report, "note"));
    assert(csv.includes("EMR-4") && csv.includes("Outstanding balance"), "the CSV lists the figures and the registrations that owe");
    assert(!csv.includes("Sample") && !csv.includes("Registrant") && !/@/.test(csv), "the CSV has no names or contact details");
    console.log("Event money report checks passed");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
