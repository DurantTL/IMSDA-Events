import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { MerchandiseOrdersPanel } from "@/components/merchandise-orders-panel";
import { canViewMerchandiseOrders, listMerchandiseOrders } from "@/modules/merchandise/order-list";
import { MerchandiseAdminWorkspace } from "@/components/merchandise-admin-workspace";
import { PageHeader } from "@/components/page-header";
import { resolveEventContext } from "@/modules/events/selection";
import { staffPageTitles } from "@/components/staff-navigation";

export const metadata: Metadata = { title: staffPageTitles.merchandise };

export default async function MerchandisePage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const requested = (await searchParams).event;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("CONFIGURE_EVENT")) {
    return (
      <>
        <PageHeader title={staffPageTitles.merchandise} />
        <AccessRestricted title="Merchandise access is restricted" detail="Changing products, artwork, or availability needs configuration access." whoToAsk="your event administrator" />
      </>
    );
  }
  const orderList = canViewMerchandiseOrders(permissions) ? await listMerchandiseOrders(event.id) : null;
  return (
    <>
      <MerchandiseAdminWorkspace eventId={event.id} />
      {orderList && <MerchandiseOrdersPanel orders={orderList.orders} totals={orderList.totals} truncated={orderList.truncated} />}
    </>
  );
}
