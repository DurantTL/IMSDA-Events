import styles from "./merchandise-orders-panel.module.css";
import { formatCents } from "@/modules/payments/format-cents";
import type { MerchandiseTotalsRow, StaffMerchandiseOrder } from "@/modules/merchandise/order-list-domain";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

/** The staff merchandise order list (#146): totals by product and size, then each order. Read-only. */
export function MerchandiseOrdersPanel({ orders, totals, truncated = false }: { orders: StaffMerchandiseOrder[]; totals: MerchandiseTotalsRow[]; truncated?: boolean }) {
  return (
    <section className={styles.panel} aria-labelledby="merchandise_orders_title" data-testid="merchandise-orders">
      <h2 id="merchandise_orders_title">Orders</h2>
      {orders.length === 0 ? (
        <p className={styles.note}>No merchandise orders yet.</p>
      ) : (
        <>
          <h3>Totals by product and size</h3>
          <p className={styles.note}>Cancelled and refunded orders are not counted.</p>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead><tr><th scope="col">Product</th><th scope="col">Size</th><th scope="col">Quantity</th></tr></thead>
              <tbody>
                {totals.map((row) => (
                  <tr key={`${row.productName}|${row.variantLabel}`}><td>{row.productName}</td><td>{row.variantLabel}</td><td>{row.quantity}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>All orders</h3>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead><tr><th scope="col">Date</th><th scope="col">Registration</th><th scope="col">Purchaser</th><th scope="col">Items</th><th scope="col">Total</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td>{dateFormat.format(new Date(order.createdAt))}</td>
                    <td translate="no">{order.confirmationCode ?? "None"}</td>
                    <td>{order.purchaserName}</td>
                    <td><ul className={styles.items}>{order.lines.map((line, index) => <li key={index}>{line.quantity} × {line.productName} {line.variantLabel}</li>)}</ul></td>
                    <td translate="no">{formatCents(order.totalCents)}</td>
                    <td>{order.statusWord}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {truncated && <p className={styles.note}>Showing the newest 500 orders.</p>}
        </>
      )}
    </section>
  );
}
