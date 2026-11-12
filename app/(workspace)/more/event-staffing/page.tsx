import type { Metadata } from "next";
import Link from "next/link";
import { AccessRestricted } from "@/components/access-restricted";
import { EventStaffingPanel } from "@/components/event-staffing-panel";
import { EventStaffingSheet } from "@/components/event-staffing-sheet";
import { NotAvailableForEvent } from "@/components/not-available-for-event";
import { staffPageTitles } from "@/components/staff-navigation";
import { logError } from "@/lib/logger";
import { getCurrentSession } from "@/modules/access/current-session";
import { StaffingError, requireStaffStaffingReader } from "@/modules/event-staffing/access";
import { listPickerPeople, loadStaffingSheet } from "@/modules/event-staffing/repository";
import { loadStaffingToolState } from "@/modules/event-staffing/settings";
import { findActiveMembership } from "@/modules/events/repository";
import { resolveEventContext } from "@/modules/events/selection";

export const metadata: Metadata = { title: staffPageTitles.eventStaffing };
export const dynamic = "force-dynamic";

/**
 * Staff screen for the optional Event staffing sheet (#1678): the switch, and the sheet itself. Switching is for a system
 * administrator, an Event Admin or the Clubs Administrator; reading is for staff holding VIEW_EVENT and system administrators;
 * changing an activity or who is on it needs CONFIGURE_EVENT. All checked on the server, here and again by every API route the
 * sheet calls. The sheet lists names of people on the event, so a page that fails the read check shows none.
 */
export default async function EventStaffingPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const requested = (await searchParams).event;
  const { event, user, membership } = await resolveEventContext(requested);
  const canSwitch = user.globalRole === "SYSTEM_ADMIN" || membership?.role === "EVENT_ADMIN";
  const reader = await requireStaffStaffingReader(await getCurrentSession(), event.id, findActiveMembership).catch(() => null);
  if (!canSwitch && !reader) {
    return <AccessRestricted title="Event staffing is restricted" detail="Event staff and event administrators can open the staffing sheet. Event administrators and the Clubs Administrator turn it on." whoToAsk="your event administrator" />;
  }
  let loaded: { state: Awaited<ReturnType<typeof loadStaffingToolState>>; activities: Awaited<ReturnType<typeof loadStaffingSheet>> | null; picker: Awaited<ReturnType<typeof listPickerPeople>> | null };
  try {
    const state = await loadStaffingToolState(event.id, "staff");
    loaded = state.enabled && reader
      ? { state, activities: await loadStaffingSheet(event.id), picker: reader.canWrite ? await listPickerPeople(event.id) : null }
      : { state, activities: null, picker: null };
  } catch (error) {
    if (error instanceof StaffingError && error.code === "EVENT_NOT_FOUND") {
      return <NotAvailableForEvent reason="Event staffing is for club events. Choose a club event, or this one may be archived." />;
    }
    logError("Event staffing page read failed", error, { eventId: event.id });
    return (
      <section className="page-stack">
        <div className="panel page-stack">
          <h2>Event staffing</h2>
          <p>The staffing sheet couldn&apos;t be loaded right now.</p>
          <p className="field-help">Pick another event from the event menu, or <Link href="/more">go back to More</Link> and try again.</p>
        </div>
      </section>
    );
  }
  const { state, activities, picker } = loaded;
  return (
    <section className="page-stack">
      <div className="panel page-stack">
        <h2>Event staffing<br /><span translate="no">{event.name}</span></h2>
        <p className="field-help">
          An optional sheet for the event&apos;s activities: who leads each one, which adults help, and how many lifeguards and TLTs each still needs.
          Only people registered for this event, or on its staff, can be put on an activity. Turning it off hides it and keeps what you entered.
        </p>
        {canSwitch ? (
          <EventStaffingPanel endpoint={`/api/events/${encodeURIComponent(event.id)}/staffing`} initial={{ enabled: state.enabled }} />
        ) : (
          <p className="field-help">Event staffing is {state.enabled ? "on" : "off"}. Event administrators and the Clubs Administrator turn it on or off.</p>
        )}
      </div>
      {activities && reader && (
        <div className="panel page-stack">
          <EventStaffingSheet
            canEdit={reader.canWrite}
            endpoint={`/api/events/${encodeURIComponent(event.id)}/staffing`}
            eventName={event.name}
            initialActivities={activities}
            pickerTruncated={picker?.truncated ?? false}
            people={picker?.people ?? []}
          />
        </div>
      )}
    </section>
  );
}
