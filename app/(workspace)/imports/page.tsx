import type { Metadata } from "next";
import { StaffContextualHelp } from "@/components/contextual-help-slot";
import { PageHeader } from "@/components/page-header";
import { AccessRestricted } from "@/components/access-restricted";
import { ImportWorkspace } from "@/components/import-workspace";
import { getImportReconciliation, listImportRuns } from "@/modules/imports/repository";
import { resolveEventContext } from "@/modules/events/selection";
import { staffPageTitles } from "@/components/staff-navigation";
import styles from "@/components/import-workspace.module.css";

export const metadata: Metadata = { title: staffPageTitles.imports };

export default async function ImportsPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_IMPORTS")) {
    return (
      <>
        <PageHeader title={staffPageTitles.imports} />
        <AccessRestricted title="Staging imports are restricted" detail="Only event administrators can preview, reconcile, and commit source snapshots." whoToAsk="your event administrator" />
      </>
    );
  }
  const [runs, reconciliation] = await Promise.all([listImportRuns(event.id), getImportReconciliation(event.id)]);
  return (
    <>
      <PageHeader title={staffPageTitles.imports} description={`Preview a CSV snapshot, inspect matching decisions, and commit validated records to ${event.name} locally.`} extra={<div className={styles.helpSlot}><StaffContextualHelp guideId="import-with-preview" event={requested} /></div>} />
      <ImportWorkspace key={event.id} eventId={event.id} initialRuns={runs} initialReconciliation={reconciliation} />
    </>
  );
}
