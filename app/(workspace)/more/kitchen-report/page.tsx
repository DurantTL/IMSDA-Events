import type { Metadata } from "next";
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
import { Download } from "lucide-react";
import { ExportLink } from "@/components/export-link";
import { MealsViewsStrip } from "@/components/meals-views-strip";
import { PrintReportButton } from "@/components/print-report-button";
import { StaffPageHeader } from "@/components/staff-page-header";
import styles from "@/components/meals-kitchen.module.css";
import { firstParam } from "@/lib/search-params";

export const metadata: Metadata = { title: staffPageTitles.kitchenReport };

/** Kitchen report (#787). VIEW_REPORTS only: it holds counts and anonymous answers, so it needs no sensitive or health access. */
export default async function KitchenReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const requestedEvent = firstParam(params.event);
  const { event, permissions } = await resolveEventContext(requestedEvent, { allowWithoutEventView: true });
  // Kitchen staff hold no report access: their page is the counts page, which holds no registration data (#1029).
  if (!permissions.includes("VIEW_REPORTS") && permissions.includes("MANAGE_KITCHEN_COUNTS")) {
    redirect(`/more/kitchen-report/counts?event=${encodeURIComponent(event.id)}`);
  }
  // The strip lists only the pages this viewer passes the same check for (#1579).
  const strip = <MealsViewsStrip current="kitchen-report" eventId={event.id} permissions={permissions} />;
  if (!permissions.includes("VIEW_REPORTS")) {
    return <>{strip}<AccessRestricted title="The kitchen report is restricted" detail="Your event role does not include access to reports." whoToAsk="your event administrator" /></>;
  }
  const [report, served, counts] = await Promise.all([loadKitchenReport(event.id), loadServedReport(event.id), loadKitchenCountsReport(event.id)]);
  const eventQuery = `event=${encodeURIComponent(event.id)}`;
  return (
    <>
      {strip}
      <div className="page-stack">
      <div className={styles.printHide}>
        <StaffPageHeader
          description={`Confirmed registrations only. ${report.totalPeople} ${report.totalPeople === 1 ? "person" : "people"} counted, ${report.peopleWithNeeds} with a dietary need. Answers are shown as typed and are not linked to anyone.`}
          extra={<>
            <ExportLink className="secondary-button" href={`/api/events/${encodeURIComponent(event.id)}/exports/kitchen`}><Download aria-hidden="true" size={16} /> Download CSV</ExportLink>
            <PrintReportButton label="Print" />
          </>}
        />
      </div>
      <KitchenReportView eventName={event.name} report={report} csvHref={`/api/events/${encodeURIComponent(event.id)}/exports/kitchen`} showHeader={false} />
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
    </>
  );
}
