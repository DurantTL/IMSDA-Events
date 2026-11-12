import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { CoordinatorUnavailable } from "@/components/coordinator-overview";
import { EventStaffingPanel } from "@/components/event-staffing-panel";
import { EventStaffingSheet } from "@/components/event-staffing-sheet";
import { logError } from "@/lib/logger";
import { StaffingError, assertStaffingAccess, requireAreaCoordinatorStaffingActor } from "@/modules/event-staffing/access";
import { listPickerPeople, loadStaffingSheet } from "@/modules/event-staffing/repository";
import { loadStaffingToolState } from "@/modules/event-staffing/settings";
import { currentAreaCoordinator, currentAreaCoordinatorViewerActive } from "@/modules/organizations/area-coordinators";

export const metadata: Metadata = { title: "Event staffing", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * The staffing sheet for one club event (#1678): the optional tool an Area Coordinator switches on, then fills with activities
 * and people. Their write is the switch, the activities and who is on them. Staff acting as a coordinator (#442) see a
 * view-only note and no sheet.
 */
export default async function AreaStaffingPage({ params }: { params: Promise<{ eventId: string }> }) {
  // Layouts do not re-run on navigation, so every page checks for itself (#657).
  if (!(await currentAreaCoordinatorViewerActive())) notFound();
  const { eventId } = await params;
  const account = await currentAreaCoordinator();
  const loaded = account
    ? await (async () => {
      const state = await loadStaffingToolState(eventId, "area-coordinator");
      if (!state.enabled) return { state, activities: null, picker: null };
      const actor = await requireAreaCoordinatorStaffingActor();
      await assertStaffingAccess(actor, eventId, "read");
      const [activities, picker] = await Promise.all([loadStaffingSheet(eventId), listPickerPeople(eventId)]);
      return { state, activities, picker };
    })().catch((error: unknown) => {
      if (error instanceof StaffingError && error.code === "EVENT_NOT_FOUND") return "missing" as const;
      logError("Coordinator event staffing read failed", error, { eventId });
      return null;
    })
    : "view-only" as const;
  if (loaded === "missing") notFound();
  return (
    <section className="public-manage-card page-stack coordinator-destination">
      <BackLink href="/account/area-clubs/events">Back to club events</BackLink>
      {loaded === null ? (
        <CoordinatorUnavailable what="Event staffing" />
      ) : loaded === "view-only" ? (
        <>
          <div className="public-manage-card-heading">
            <p className="public-registration-eyebrow">Club coordination</p>
            <h2>Event staffing</h2>
          </div>
          <p className="field-help">Only an Area Coordinator signed in with their own account can use this tool.</p>
        </>
      ) : (
        <>
          <div className="public-manage-card-heading">
            <p className="public-registration-eyebrow">Club coordination</p>
            <h2>Event staffing<br /><span translate="no">{loaded.state.eventName}</span></h2>
          </div>
          <p className="field-help">
            An optional sheet for the event&apos;s activities: who leads each one, which adults help, and how many lifeguards and TLTs each still needs.
            Only people registered for this event, or on its staff, can be put on an activity. Turning it off hides it and keeps what you entered.
          </p>
          <EventStaffingPanel endpoint={`/api/attendee/area-clubs/events/${encodeURIComponent(eventId)}/staffing`} initial={{ enabled: loaded.state.enabled }} />
          {loaded.activities && (
            <EventStaffingSheet
              canEdit
              endpoint={`/api/attendee/area-clubs/events/${encodeURIComponent(eventId)}/staffing`}
              eventName={loaded.state.eventName}
              initialActivities={loaded.activities}
              pickerTruncated={loaded.picker?.truncated ?? false}
              people={loaded.picker?.people ?? []}
            />
          )}
        </>
      )}
    </section>
  );
}
