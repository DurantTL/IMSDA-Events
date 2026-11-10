import type { Metadata } from "next";
import Link from "next/link";
import { AccessRestricted } from "@/components/access-restricted";
import { LodgingViewsStrip } from "@/components/lodging-views-strip";
import { LodgingRequestsWorkspace } from "@/components/lodging-requests-workspace";
import { StaffPageHeader } from "@/components/staff-page-header";
import { staffPageTitles } from "@/components/staff-navigation";
import { resolveEventContext } from "@/modules/events/selection";
import { LodgingError } from "@/modules/lodging/errors";
import { lodgingViewAccess } from "@/modules/lodging/lodging-views-model";
import { getStaffLodgingRequestsView } from "@/modules/lodging/preferences-service";

export const metadata: Metadata = { title: staffPageTitles.lodgingRequests };

export default async function LodgingRequestsPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  // The strip lists only the pages this viewer passes the same check for (#1578).
  const strip = <LodgingViewsStrip access={lodgingViewAccess(permissions)} current="requests" eventId={event.id} />;
  // Decided here on the server, and again by every API route the screen calls.
  if (!permissions.includes("MANAGE_REGISTRATION")) {
    return <>{strip}<AccessRestricted title="Lodging requests are restricted" detail="Staff who manage registrations can review what guests asked for." whoToAsk="your event administrator" /></>;
  }
  const view = await getStaffLodgingRequestsView(event.id, { canSeeSensitive: permissions.includes("VIEW_SENSITIVE_DATA") }).catch((error: unknown) => {
    if (error instanceof LodgingError && error.code === "NO_PROPERTY") return null;
    throw error;
  });
  if (!view) {
    return (
      <>
        {strip}
        <StaffPageHeader description="Lodging is set up per event, starting with its property." />
        <section className="panel">
          <p>This event has no lodging property yet. {permissions.includes("CONFIGURE_EVENT") ? <>An event administrator chooses one on the <Link href={`/more/lodging?event=${encodeURIComponent(event.id)}`}>Lodging page</Link> first.</> : "Ask your event administrator to choose one first."}</p>
        </section>
      </>
    );
  }
  return (
    <>
      {strip}
      <LodgingRequestsWorkspace
        eventName={event.name}
        initialView={view}
        canConfigure={permissions.includes("CONFIGURE_EVENT")}
        canExport={permissions.includes("VIEW_REPORTS")}
      />
    </>
  );
}
