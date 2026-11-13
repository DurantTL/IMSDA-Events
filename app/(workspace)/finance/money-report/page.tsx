import type { Metadata } from "next";
import { staffPageTitles } from "@/components/staff-navigation";
import { AccessRestricted } from "@/components/access-restricted";
import { EventMoneyReportView } from "@/components/event-money-report";
import { resolveEventContext } from "@/modules/events/selection";
import { loadEventMoneyReport, loadUnmatchedSquareSummary } from "@/modules/payments/event-money-report-repository";

export const metadata: Metadata = { title: staffPageTitles.eventMoneyReport };

export default async function EventMoneyReportPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_FINANCE") && !permissions.includes("VIEW_REPORTS")) {
    return <AccessRestricted title="Finance is restricted" detail="Only event administrators, finance managers and people who can view reports can open the event money report." whoToAsk="your event administrator" />;
  }
  const canManageFinance = permissions.includes("MANAGE_FINANCE");
  // The Square read has its own few-second limit, so a slow Square never holds the page up.
  const [data, unmatchedSquare] = await Promise.all([
    loadEventMoneyReport(event.id),
    loadUnmatchedSquareSummary(event.id),
  ]);
  return <EventMoneyReportView key={event.id} eventId={event.id} data={data} canManageFinance={canManageFinance} unmatchedSquare={unmatchedSquare} />;
}
