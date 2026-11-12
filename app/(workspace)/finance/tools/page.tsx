import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { AdminHub } from "@/components/admin-hub";
import { staffPageTitles } from "@/components/staff-navigation";
import { resolveEventContext } from "@/modules/events/selection";
import { buildMoneyToolsView } from "@/modules/payments/money-tools-model";
import { loadMoneyToolMetrics } from "@/modules/payments/money-tools-repository";

export const metadata: Metadata = { title: staffPageTitles.moreMoneyTools };
export const dynamic = "force-dynamic";

/**
 * The event's other finance pages as grouped cards (#1575). MANAGE_FINANCE is checked here on the server, like every finance
 * page; the numbers are read only for the cards that viewer sees. Everything on the page is a link: nothing here refunds,
 * matches or changes a record.
 */
export default async function MoreMoneyToolsPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions, user } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_FINANCE")) {
    return <AccessRestricted title="Finance is restricted" detail="Only event administrators and finance managers can open the finance tools." whoToAsk="your event administrator" />;
  }
  const viewer = { permissions, isSystemAdmin: user.globalRole === "SYSTEM_ADMIN" };
  const values = await loadMoneyToolMetrics(viewer, event.id);
  return <AdminHub view={buildMoneyToolsView(viewer, event.id, values)} />;
}
