import { ExportLink } from "@/components/export-link";
import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { AccessRestricted } from "@/components/access-restricted";
import { EmergencyReferenceSheetView } from "@/components/emergency-reference-sheet";
import { PrintReportButton } from "@/components/print-report-button";
import { staffPageTitles } from "@/components/staff-navigation";
import { isModuleEnabled } from "@/modules/event-modules/service";
import { buildEmergencyPlanSnapshot } from "@/modules/emergency-plans/domain";
import { getEmergencyPlanDraft, getEmergencyPlanEvent, getEmergencyPlanVersion } from "@/modules/emergency-plans/repository";
import { resolveEventContext } from "@/modules/events/selection";
import { buildEmergencyReferenceSheet } from "@/modules/reporting/emergency-reference";

export const metadata: Metadata = { title: staffPageTitles.emergencyPlan };
export const dynamic = "force-dynamic";

/**
 * The printable emergency reference (#114): a published version (`?version=N`,
 * default the latest), or `?draft=1` for a preview that is plainly marked as a
 * draft. VIEW_EVENT to print; a draft preview needs CONFIGURE_EVENT. The sheet
 * is built from the snapshot alone.
 */
export default async function EmergencyPlanPrintPage({ searchParams }: { searchParams: Promise<{ event?: string; version?: string; draft?: string }> }) {
  const { event: requested, version, draft } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("VIEW_EVENT")) {
    return <AccessRestricted title="The emergency plan is restricted" detail="Ask an event administrator for access to this event." />;
  }
  if (!(await isModuleEnabled(event.id, "emergency-plans"))) {
    return <AccessRestricted title="The emergency plan is not turned on" detail="A system administrator turns on the Emergency plan for an event before staff can use it." />;
  }
  const eventQuery = `event=${encodeURIComponent(event.id)}`;
  const back = <Link className="secondary-button" href={`/more/emergency-plan?${eventQuery}`}>Back to the emergency plan</Link>;

  let sheet;
  let versionNumber: number | null = null;
  if (draft === "1") {
    if (!permissions.includes("CONFIGURE_EVENT")) {
      return <AccessRestricted title="Draft previews are restricted" detail="Event administrators can preview the unpublished draft. Print a published version instead." />;
    }
    const [plan, eventRow] = await Promise.all([getEmergencyPlanDraft(event.id), getEmergencyPlanEvent(event.id)]);
    if (!eventRow) return <AccessRestricted title="Event not found" detail="This event could not be loaded." />;
    sheet = buildEmergencyReferenceSheet(buildEmergencyPlanSnapshot(plan, eventRow), null);
  } else {
    const requestedVersion = version === undefined ? undefined : Number(version);
    if (requestedVersion !== undefined && (!Number.isInteger(requestedVersion) || requestedVersion < 1)) {
      return <AccessRestricted title="Version not found" detail="Choose a published version from the emergency plan page." />;
    }
    const published = await getEmergencyPlanVersion(event.id, requestedVersion);
    if (!published) {
      return (
        <section className="page-stack">
          <div className="panel"><p>{requestedVersion ? `Version ${requestedVersion} has not been published.` : "Nothing is published yet. Publish the plan to print it."}</p>{back}</div>
        </section>
      );
    }
    versionNumber = published.versionNumber;
    sheet = buildEmergencyReferenceSheet(published.snapshot, published);
  }

  const actions = (
    <>
      {back}
      {versionNumber !== null && (
        <ExportLink className="secondary-button" href={`/api/events/${encodeURIComponent(event.id)}/emergency-plan/export?version=${versionNumber}`}><Download aria-hidden="true" size={15} /> Download CSV</ExportLink>
      )}
      <PrintReportButton label="Print the reference" />
    </>
  );

  return (
    <>
      <style>{"@page { size: letter portrait; margin: 0.6in 0.6in 0.6in 0.6in; }"}</style>
      <EmergencyReferenceSheetView actions={actions} generatedAtIso={new Date().toISOString()} sheet={sheet} />
    </>
  );
}
