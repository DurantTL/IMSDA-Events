import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { AttendeeConfigurationWorkspace } from "@/components/attendee-configuration-workspace";
import { resolveEventContext } from "@/modules/events/selection";
import { listAttendeeConfiguration } from "@/modules/attendee-types/repository";
import headerStyles from "@/components/attendee-configuration-workspace.module.css";
import { PageHeader } from "@/components/page-header";
import { staffPageTitles } from "@/components/staff-navigation";

export const metadata: Metadata = { title: staffPageTitles.attendeeSetup };

export default async function AttendeeConfigurationPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("CONFIGURE_EVENT")) {
    return <AccessRestricted title="Attendee setup is restricted" detail="Event administrators can configure attendee identities and groupings." whoToAsk="your event administrator" />;
  }
  const configuration = await listAttendeeConfiguration(event.id);
  const types = configuration.attendeeTypes.map((row) => ({
    id: row.id, code: row.code, label: row.label, description: row.description,
    sortOrder: row.sortOrder, isActive: row.isActive, minimumAge: row.minimumAge, maximumAge: row.maximumAge,
  }));
  const classifications = configuration.classifications.map((row) => ({
    id: row.id, kind: row.kind, code: row.code, label: row.label,
    description: row.description, sortOrder: row.sortOrder, isActive: row.isActive,
  }));
  const header = (
    <PageHeader
      below={<nav aria-label="On this page" className={headerStyles.anchors}><a href="#attendee-types">Attendee types</a><a href="#attendee-groupings">Categories, tracks, and departments</a></nav>}
      description="Choose who can register and how attendees are grouped."
      title={staffPageTitles.attendeeSetup}
    />
  );
  return <div className="settings-stack">{header}<AttendeeConfigurationWorkspace eventId={event.id} initialTypes={types} initialClassifications={classifications} canCreate={permissions.includes("CONFIGURE_EVENT")} canManageForms={permissions.includes("MANAGE_FORMS")} /></div>;
}
