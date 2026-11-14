import { merchandiseOrderStatusWords, type MerchandiseOrderStatusValue } from "@/modules/merchandise/domain";
import { merchandisePaymentMethodLine, type MerchandiseOrderActionValue } from "@/modules/merchandise/order-actions-domain";

export type StaffMerchandiseOrder = {
  id: string;
  createdAt: string;
  confirmationCode: string | null;
  purchaserName: string;
  status: MerchandiseOrderStatusValue;
  statusWord: string;
  /** False when the order's registration was cancelled: it stays listed but is not counted in the totals. */
  registrationActive: boolean;
  totalCents: number;
  /** Set when staff marked the order paid or comped it (#148). */
  receiptNumber: string | null;
  /** "Cash", "Check #123", "Card (Square), ref …" or "Comped — no charge"; null while unpaid. */
  paymentLine: string | null;
  paidAt: string | null;
  lines: Array<{ productName: string; variantLabel: string; quantity: number; lineTotalCents: number }>;
  /** Staff actions, oldest first: who, when, what and the reason they gave. */
  history: Array<{ id: string; action: MerchandiseOrderActionValue | null; fromStatus: MerchandiseOrderStatusValue; toStatus: MerchandiseOrderStatusValue; actorName: string; createdAt: string; reason: string | null }>;
};

export type MerchandiseTotalsRow = { productName: string; variantLabel: string; quantity: number };

type OrderLike = Pick<StaffMerchandiseOrder, "status" | "lines"> & { registrationActive?: boolean };

/** Units by product and size, leaving out cancelled and refunded orders and orders whose registration was cancelled. */
export function merchandiseTotalsBySize(orders: ReadonlyArray<OrderLike>): MerchandiseTotalsRow[] {
  const totals = new Map<string, MerchandiseTotalsRow>();
  for (const order of orders) {
    if (order.status === "CANCELLED" || order.status === "REFUNDED" || order.registrationActive === false) continue;
    for (const line of order.lines) {
      const key = `${line.productName}\u0000${line.variantLabel}`;
      const row = totals.get(key) ?? { productName: line.productName, variantLabel: line.variantLabel, quantity: 0 };
      row.quantity += line.quantity;
      totals.set(key, row);
    }
  }
  return [...totals.values()].sort((a, b) => a.productName.localeCompare(b.productName) || a.variantLabel.localeCompare(b.variantLabel, undefined, { numeric: true }));
}

function snapshotText(snapshot: unknown, key: string) {
  if (snapshot && typeof snapshot === "object" && typeof (snapshot as Record<string, unknown>)[key] === "string") return (snapshot as Record<string, string>)[key]!;
  return null;
}

export function staffOrderFromRecord(order: {
  id: string;
  createdAt: Date;
  status: MerchandiseOrderStatusValue;
  totalCents: number;
  purchaserSnapshot: unknown;
  registrationId: string | null;
  registration: { status: string } | null;
  receiptNumber?: string | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  paidAt?: Date | null;
  lines: Array<{ productNameSnapshot: string; variantLabelSnapshot: string; quantity: number; lineTotalCents: number }>;
  statusChanges?: Array<{ id: string; action: MerchandiseOrderActionValue | null; fromStatus: MerchandiseOrderStatusValue; toStatus: MerchandiseOrderStatusValue; reason: string | null; createdAt: Date; actor: { displayName: string } | null }>;
}): StaffMerchandiseOrder {
  return {
    id: order.id,
    createdAt: order.createdAt.toISOString(),
    confirmationCode: snapshotText(order.purchaserSnapshot, "confirmationCode"),
    purchaserName: snapshotText(order.purchaserSnapshot, "name") ?? "Unknown",
    status: order.status,
    statusWord: merchandiseOrderStatusWords[order.status],
    // An order with no registration link counts. That covers a staff order and also an order whose registration was
    // deleted (the link is cleared on delete), so a deleted registration's order still counts for now (follow-up).
    // A cancelled registration's order does not count.
    registrationActive: order.registrationId === null ? order.registration === null : order.registration !== null && order.registration.status !== "CANCELLED",
    totalCents: order.totalCents,
    receiptNumber: order.receiptNumber ?? null,
    paymentLine: merchandisePaymentMethodLine({ status: order.status, method: order.paymentMethod ?? null, reference: order.paymentReference ?? null }),
    paidAt: order.paidAt?.toISOString() ?? null,
    history: (order.statusChanges ?? []).map((change) => ({ id: change.id, action: change.action, fromStatus: change.fromStatus, toStatus: change.toStatus, actorName: change.actor?.displayName ?? "Staff", createdAt: change.createdAt.toISOString(), reason: change.reason })),
    lines: order.lines.map((line) => ({ productName: line.productNameSnapshot, variantLabel: line.variantLabelSnapshot, quantity: line.quantity, lineTotalCents: line.lineTotalCents })),
  };
}
