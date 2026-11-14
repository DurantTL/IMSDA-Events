import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { paginate, parsePageParam } from "@/lib/pagination";
import { serverSort, sortRows } from "@/lib/list-sort";
import { MERCHANDISE_ORDERS_SORT_COLUMNS } from "@/lib/staff-sort-columns";
import { MerchandiseOrdersPanel } from "@/components/merchandise-orders-panel";
import { canViewMerchandiseOrders, listMerchandiseOrders } from "@/modules/merchandise/order-list";
import { merchandiseOrderActionPermissions } from "@/modules/merchandise/order-actions-domain";
import { MerchandiseAdminWorkspace } from "@/components/merchandise-admin-workspace";
import { PageHeader } from "@/components/page-header";
import { getCurrentSession } from "@/modules/access/current-session";
import { resolveEventContext } from "@/modules/events/selection";
import { staffPageTitles } from "@/components/staff-navigation";

export const metadata: Metadata = { title: staffPageTitles.merchandise };

export default async function MerchandisePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const requested = typeof query.event === "string" ? query.event : undefined;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("CONFIGURE_EVENT")) {
    return (
      <>
        <PageHeader title={staffPageTitles.merchandise} />
        <AccessRestricted title="Merchandise access is restricted" detail="Changing products, artwork, or availability needs configuration access." whoToAsk="your event administrator" />
      </>
    );
  }
  const canApproveSales = (await getCurrentSession()).user?.globalRole === "SYSTEM_ADMIN";
  const orderList = canViewMerchandiseOrders(permissions) ? await listMerchandiseOrders(event.id) : null;
  const sorting = serverSort("/more/merchandise", query, MERCHANDISE_ORDERS_SORT_COLUMNS, { key: "date", dir: "desc" });
  const sorted = orderList
    ? sortRows(orderList.orders, sorting.order.key, sorting.order.dir, {
        date: (order) => order.createdAt,
        registration: (order) => order.confirmationCode,
        purchaser: (order) => order.purchaserName,
        total: (order) => order.totalCents,
        status: (order) => order.statusWord,
      })
    : [];
  const slice = paginate(sorted, parsePageParam(typeof query.page === "string" ? query.page : undefined), 25);
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) if (typeof value === "string" && name !== "page") params.set(name, value);
    if (page > 1) params.set("page", String(page));
    const text = params.toString();
    return `/more/merchandise${text ? `?${text}` : ""}`;
  };
  return (
    <>
      <MerchandiseAdminWorkspace canApproveSales={canApproveSales} eventId={event.id} />
      {orderList && <MerchandiseOrdersPanel eventId={event.id} permissions={merchandiseOrderActionPermissions(permissions)} pageHref={pageHref} slice={slice} sorting={sorting} totals={orderList.totals} />}
    </>
  );
}
