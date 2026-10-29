import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { EmergencyPlanWorkspace } from "@/components/emergency-plan-workspace";
import { staffPageTitles } from "@/components/staff-navigation";
import { isModuleEnabled } from "@/modules/event-modules/service";
import { formatPrintTimestamp } from "@/modules/emergency-plans/domain";
import { getEmergencyPlanDraft, listEmergencyPlanVersions } from "@/modules/emergency-plans/repository";
import { resolveEventContext } from "@/modules/events/selection";

export const metadata: Metadata = { title: staffPageTitles.emergencyPlan };
export const dynamic = "force-dynamic";

/** Event emergency plan (#114). Viewing follows VIEW_EVENT; editing and publishing need CONFIGURE_EVENT; the module must be on. */
export default async function EmergencyPlanPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("VIEW_EVENT")) {
    return <AccessRestricted title="The emergency plan is restricted" detail="Ask an event administrator for access to this event." />;
  }
  if (!(await isModuleEnabled(event.id, "emergency-plans"))) {
    return <AccessRestricted title="The emergency plan is not turned on" detail="A system administrator turns on the Emergency plan for an event before staff can use it." />;
  }
  const [draft, versions] = await Promise.all([getEmergencyPlanDraft(event.id), listEmergencyPlanVersions(event.id)]);
  return (
    <EmergencyPlanWorkspace
      canEdit={permissions.includes("CONFIGURE_EVENT")}
      eventId={event.id}
      eventName={event.name}
      initialDraft={draft}
      versions={versions.map((version) => ({ versionNumber: version.versionNumber, publishedLabel: formatPrintTimestamp(version.publishedAt, event.timezone) }))}
    />
  );
}
