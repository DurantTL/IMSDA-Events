import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { staffPageTitles } from "@/components/staff-navigation";
import { AccessRestricted } from "@/components/access-restricted";
import { EventCloseoutView } from "@/components/event-closeout";
import { resolveEventContext } from "@/modules/events/selection";
import { canSignOff, getCloseoutView } from "@/modules/events/closeout-repository";

export const metadata: Metadata = { title: staffPageTitles.eventCloseout };

export default async function EventCloseoutPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_FINANCE") && !permissions.includes("FINALIZE_INVOICES") && !permissions.includes("VIEW_REPORTS")) {
    return <AccessRestricted title="Closeout is restricted" detail="Only finance managers, people who can finalize invoices and people who can view reports can open the event closeout." whoToAsk="your event administrator" />;
  }
  const data = await getCloseoutView(event.id, { canReadText: canSignOff(permissions) });
  if (!data) notFound();
  return <EventCloseoutView key={event.id} data={data} canSignOff={canSignOff(permissions)} canManageFinance={permissions.includes("MANAGE_FINANCE")} canOpenMoneyReport={permissions.includes("MANAGE_FINANCE") || permissions.includes("VIEW_REPORTS")} canViewEvent={permissions.includes("VIEW_EVENT")} />;
}
