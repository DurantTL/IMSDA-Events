import { merchandiseOrderStatusWords, type MerchandiseOrderStatusValue } from "@/modules/merchandise/domain";

export type StaffMerchandiseOrder = {
  id: string;
  createdAt: string;
  confirmationCode: string | null;
  purchaserName: string;
  status: MerchandiseOrderStatusValue;
  statusWord: string;
  totalCents: number;
  lines: Array<{ productName: string; variantLabel: string; quantity: number; lineTotalCents: number }>;
};

export type MerchandiseTotalsRow = { productName: string; variantLabel: string; quantity: number };

type OrderLike = Pick<StaffMerchandiseOrder, "status" | "lines">;

/** Units by product and size, leaving out cancelled and refunded orders. */
export function merchandiseTotalsBySize(orders: ReadonlyArray<OrderLike>): MerchandiseTotalsRow[] {
  const totals = new Map<string, MerchandiseTotalsRow>();
  for (const order of orders) {
    if (order.status === "CANCELLED" || order.status === "REFUNDED") continue;
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
  lines: Array<{ productNameSnapshot: string; variantLabelSnapshot: string; quantity: number; lineTotalCents: number }>;
}): StaffMerchandiseOrder {
  return {
    id: order.id,
    createdAt: order.createdAt.toISOString(),
    confirmationCode: snapshotText(order.purchaserSnapshot, "confirmationCode"),
    purchaserName: snapshotText(order.purchaserSnapshot, "name") ?? "Unknown",
    status: order.status,
    statusWord: merchandiseOrderStatusWords[order.status],
    totalCents: order.totalCents,
    lines: order.lines.map((line) => ({ productName: line.productNameSnapshot, variantLabel: line.variantLabelSnapshot, quantity: line.quantity, lineTotalCents: line.lineTotalCents })),
  };
}
