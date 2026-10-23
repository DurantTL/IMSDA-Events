import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KitchenCountsTable } from "@/components/kitchen-counts-table";
import { AccessRestricted } from "@/components/access-restricted";
import { KitchenMealsServed } from "@/components/kitchen-meals-served";
import { KitchenReportView } from "@/components/kitchen-report-view";
import { staffPageTitles } from "@/components/staff-navigation";
import { resolveEventContext } from "@/modules/events/selection";
import { loadKitchenCountsReport } from "@/modules/meals/kitchen-counts-repository";
import { loadServedReport } from "@/modules/meals/scanner-import-repository";
import { loadKitchenReport } from "@/modules/registrations/kitchen-report-loader";

export const metadata: Metadata = { title: staffPageTitles.kitchenReport };

/** Kitchen report (#787). VIEW_REPORTS only: it holds counts and anonymous answers, so it needs no sensitive or health access. */
export default async function KitchenReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const requestedEvent = Array.isArray(params.event) ? params.event[0] : params.event;
  const { event, permissions } = await resolveEventContext(requestedEvent, { allowWithoutEventView: true });
  // Kitchen staff hold no report access: their page is the counts page, which holds no registration data (#1029).
  if (!permissions.includes("VIEW_REPORTS") && permissions.includes("MANAGE_KITCHEN_COUNTS")) {
    redirect(`/more/kitchen-report/counts?event=${encodeURIComponent(event.id)}`);
  }
  if (!permissions.includes("VIEW_REPORTS")) {
    return <AccessRestricted title="The kitchen report is restricted" detail="Your event role does not include access to reports." />;
  }
  const [report, served, counts] = await Promise.all([loadKitchenReport(event.id), loadServedReport(event.id), loadKitchenCountsReport(event.id)]);
  const eventQuery = `event=${encodeURIComponent(event.id)}`;
  return (
    <div className="page-stack">
      {/* Meal money closeout (#212) holds amounts, so only finance access sees the way in; the page checks it again on the server. */}
      {permissions.includes("MANAGE_FINANCE") && (
        <p><Link className="secondary-button" href={`/more/kitchen-report/closeout?${eventQuery}`}>Meal money closeout</Link></p>
      )}
      <KitchenReportView eventName={event.name} report={report} csvHref={`/api/events/${encodeURIComponent(event.id)}/exports/kitchen`} />
      {/* Meals served against tickets sold (#1028): its own section and component, apart from the report above. */}
      <KitchenMealsServed
        report={served}
        anyImport={served.anyImport}
        importHref={`/more/kitchen-report/scanner-import?${eventQuery}`}
        csvHref={`/api/events/${encodeURIComponent(event.id)}/exports/meals-served`}
        drillHref={(key) => `/more/kitchen-report/scanner-import?${eventQuery}&service=${encodeURIComponent(key)}#ticket-details`}
      />
      {/* Kitchen-entered counts (#1029): prepared, wasted, donated and transferred beside ordered and served, never merged. */}
      <KitchenCountsTable
        report={counts}
        timeZone={counts.timeZone}
        csvHref={`/api/events/${encodeURIComponent(event.id)}/exports/kitchen-counts`}
        enterHref={permissions.includes("MANAGE_KITCHEN_COUNTS") ? `/more/kitchen-report/counts?${eventQuery}` : undefined}
      />
    </div>
  );
}
