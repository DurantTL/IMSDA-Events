import { ColumnHeader } from "@/components/column-header";
import { Money, CodeValue } from "@/components/exact-value";
import { ListPager } from "@/components/list-pager";
import { SortOrderNote } from "@/components/list-sort";
import { cardCell } from "@/components/table-card-labels";
import type { ServerSort } from "@/lib/list-sort";
import { sortLine, type MERCHANDISE_ORDERS_SORT_COLUMNS } from "@/lib/staff-sort-columns";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import type { MerchandiseTotalsRow, StaffMerchandiseOrder } from "@/modules/merchandise/order-list-domain";
import type { PageSlice } from "@/lib/pagination";
import styles from "./merchandise-orders-panel.module.css";

type OrderColumn = (typeof MERCHANDISE_ORDERS_SORT_COLUMNS)[number];

/** The staff merchandise order list (#146): totals by product and size, then each order, sortable and paged. Read-only. */
export function MerchandiseOrdersPanel({ slice, totals, sorting, pageHref }: {
  slice: PageSlice<StaffMerchandiseOrder>;
  totals: MerchandiseTotalsRow[];
  sorting: ServerSort<OrderColumn>;
  pageHref: (page: number) => string;
}) {
  return (
    <section className="panel" aria-labelledby="merchandise_orders_title" data-testid="merchandise-orders">
      <div className="section-heading"><div><h2 id="merchandise_orders_title">Orders</h2></div>{slice.total > 0 && <span className="count-badge">{slice.total} total</span>}</div>
      {slice.total === 0 ? (
        <p className="quiet-copy">No merchandise orders yet. Orders appear here when registrants add merchandise to a registration.</p>
      ) : (
        <>
          <h3 className={styles.subheading}>Totals by product and size</h3>
          <p className={styles.note}>Cancelled and refunded orders, and orders whose registration was cancelled, are not counted.</p>
          <div className="report-table-wrap">
            <table role="table" className="report-table table-cards">
              <caption className="sr-only">Merchandise totals by product and size</caption>
              <thead role="rowgroup"><tr role="row"><ColumnHeader column="product" label="Product" /><ColumnHeader column="size" label="Size" /><ColumnHeader column="quantity" label="Quantity" /></tr></thead>
              <tbody role="rowgroup">
                {totals.map((row) => (
                  <tr role="row" key={`${row.productName}|${row.variantLabel}`}>
                    <th role="rowheader" scope="row">{row.productName}</th>
                    <td {...cardCell("Size")}>{row.variantLabel}</td>
                    <td {...cardCell("Quantity")}>{row.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className={styles.subheading}>All orders</h3>
          {sorting.order.key && <SortOrderNote>{sortLine(sorting.order)}</SortOrderNote>}
          <div className="report-table-wrap">
            <table role="table" className="report-table table-cards">
              <caption className="sr-only">Merchandise orders</caption>
              <thead role="rowgroup"><tr role="row"><ColumnHeader column="purchaser" label="Purchaser" sorting={sorting} /><ColumnHeader column="date" label="Date" sorting={sorting} /><ColumnHeader column="registration" label="Registration" sorting={sorting} /><th role="columnheader" scope="col">Items</th><ColumnHeader column="total" label="Total" sorting={sorting} /><ColumnHeader column="status" label="Status" sorting={sorting} /></tr></thead>
              <tbody role="rowgroup">
                {slice.items.map((order) => (
                  <tr role="row" key={order.id}>
                    <th role="rowheader" scope="row" translate="no">{order.purchaserName}</th>
                    <td {...cardCell("Date")}>{formatInConferenceTime(order.createdAt, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                    <td {...cardCell("Registration")}>{order.confirmationCode ? <CodeValue code={order.confirmationCode} /> : "None"}</td>
                    <td {...cardCell("Items")}><ul className={styles.items}>{order.lines.map((line, index) => <li key={index}>{line.quantity} × {line.productName} {line.variantLabel}</li>)}</ul></td>
                    <td {...cardCell("Total")}><Money cents={order.totalCents} /></td>
                    <td {...cardCell("Status")}>{order.statusWord}{!order.registrationActive && <small className={styles.note}> · Registration cancelled</small>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ListPager hrefFor={pageHref} label="Merchandise order pages" noun="orders" nounOne="order" slice={slice} />
        </>
      )}
    </section>
  );
}
