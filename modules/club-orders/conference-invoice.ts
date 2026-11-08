import type { InvoiceFigures, InvoiceLine, InvoiceSnapshot } from "@/modules/invoices/domain";
import { amountsFingerprintOf } from "@/modules/invoices/domain";
import { clubOrdersGroupKey } from "@/modules/club-orders/conference-orders";
import { formatCents } from "@/modules/payments/format-cents";

/**
 * The church's invoice for filled conference club orders (#1688): pure, free of database access. One invoice line per filled
 * order; the lines are the facts, so a draft is stale when the filled orders are no longer what they were (compared by the same
 * amounts fingerprint every invoice uses).
 */

export type FilledOrderForInvoice = {
  orderId: string;
  clubId: string;
  clubName: string;
  lines: ReadonlyArray<{ itemName: string; quantity: number; unitPriceCents: number }>;
  postageCents: number;
  filledAt: Date;
};

/**
 * One filled order as an invoice line: each item as a charge ("Pathfinder Shoulder Patch, 20 at $1.25"), then postage as its
 * own charge. It prints the club's name (a church knows its clubs) and nothing about people. The order id is the line's id, so
 * the same order is the same line in every rebuild.
 */
export function clubOrderInvoiceLine(order: FilledOrderForInvoice): InvoiceLine {
  const charges = order.lines.map((line) => ({
    label: `${line.itemName}, ${line.quantity} at ${formatCents(line.unitPriceCents)}`,
    amountCents: line.quantity * line.unitPriceCents,
    kind: "CHARGE" as const,
  }));
  if (order.postageCents > 0) charges.push({ label: "Postage", amountCents: order.postageCents, kind: "CHARGE" });
  const amountCents = charges.reduce((total, charge) => total + charge.amountCents, 0);
  return {
    registrationId: order.orderId,
    confirmationCode: order.orderId.slice(-8).toUpperCase(),
    label: `Conference club order: ${order.clubName}`,
    clubId: order.clubId,
    counts: { registered: 1, checkedIn: 0, noShow: 0, addedByStaff: 0, removedByStaff: 0, billable: 1 },
    basis: "PER_PERSON_LINES",
    people: [],
    chargesNotTiedToPerson: charges,
    credits: [],
    promo: null,
    adjustmentCents: 0,
    components: { personChargesCents: 0, registrationChargeCents: amountCents, creditCents: 0, promoCents: 0, adjustmentCents: 0 },
    amountCents,
  };
}

/** The figures of a church's conference club orders invoice: one line per filled order, oldest first. */
export function buildClubOrdersInvoiceFigures(input: {
  event: { id: string; name: string };
  church: { id: string; name: string };
  orders: readonly FilledOrderForInvoice[];
}): InvoiceFigures {
  const lines = [...input.orders]
    .sort((a, b) => a.filledAt.getTime() - b.filledAt.getTime() || a.orderId.localeCompare(b.orderId))
    .map(clubOrderInvoiceLine)
    .filter((line) => line.amountCents > 0);
  const amountDueCents = lines.reduce((total, line) => total + line.amountCents, 0);
  const title = `${input.church.name} conference club orders`;
  const snapshot: InvoiceSnapshot = {
    schema: 1,
    kind: "CLUB_ORDERS",
    event: input.event,
    groupKey: clubOrdersGroupKey(input.church.id),
    groupTitle: title,
    invoiceGrouping: "PER_CHURCH",
    party: { kind: "ORGANIZATION", id: input.church.id, name: input.church.name },
    clubId: null,
    reconciliation: null,
    lines,
    totals: { registered: lines.length, checkedIn: 0, noShow: 0, billable: lines.length, amountDueCents },
  };
  return {
    snapshot,
    groupTitle: title,
    organizationName: input.church.name,
    registeredCount: lines.length,
    billableCount: lines.length,
    amountDueCents,
    amountsFingerprint: amountsFingerprintOf(lines, amountDueCents),
  };
}
