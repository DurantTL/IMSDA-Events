import type { Metadata } from "next";
import Link from "next/link";
import { AccessRestricted } from "@/components/access-restricted";
import { InspectionEntry } from "@/components/inspection-entry";
import { NotAvailableForEvent } from "@/components/not-available-for-event";
import { staffPageTitles } from "@/components/staff-navigation";
import { logError } from "@/lib/logger";
import { loadInspectionView } from "@/modules/event-inspections/service";
import { EventScoringError, type EventScoringActor } from "@/modules/event-scoring/service";
import { resolveClubOversight } from "@/modules/club-rosters/event-oversight";

export const metadata: Metadata = { title: staffPageTitles.inspections };
export const dynamic = "force-dynamic";

/**
 * Staff screen for the optional Inspections tool (#1896): the switch, the phone score entry for campsite and uniform
 * inspections, and the CSV import. The same people as Camporee scoring: administrators (system administrators, Event
 * Admins, the Clubs Administrator) use all of it; staff with the registration permission enter scores only.
 */
export default async function InspectionsPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const requested = (await searchParams).event;
  const { event, allowed, clubEvent, permissions, user } = await resolveClubOversight(requested);
  if (!clubEvent) {
    return <NotAvailableForEvent reason="This event doesn't take club registrations. Choose a club event to score inspections." />;
  }
  if (!allowed && !permissions.includes("MANAGE_REGISTRATION")) {
    return <AccessRestricted title="Inspections is restricted" detail="Inspection scoring is for event administrators, the Clubs Administrator and staff who manage registrations." whoToAsk="your event administrator" />;
  }
  const actor: EventScoringActor = { kind: "staff", userId: user.id, administrator: allowed };
  let state: Awaited<ReturnType<typeof loadInspectionView>>;
  try {
    state = await loadInspectionView(event.id, actor);
  } catch (error) {
    if (!(error instanceof EventScoringError)) logError("Inspections page read failed", error, { eventId: event.id });
    return (
      <section className="page-stack">
        <div className="panel page-stack">
          <h2>Inspections</h2>
          <p>{error instanceof EventScoringError ? "This event is archived, so inspections can't be changed." : "Inspections couldn't be loaded right now."}</p>
          <p className="field-help">Pick another club event from the event menu, or <Link href="/more">go back to More</Link> and try again.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="page-stack">
      <div className="panel page-stack">
        <h2>Inspections<br /><span translate="no">{event.name}</span></h2>
        <p className="field-help">
          An optional tool for campsite and uniform inspections. Scores go into Camporee scoring, so they rank and earn ribbons with the other scored events.
          Area Coordinators can turn it on and enter scores too. Turning it off hides this screen and keeps every score.
        </p>
        <InspectionEntry endpoint={`/api/events/${encodeURIComponent(event.id)}/inspections`} initial={state} scoringHref={`/more/event-scoring?event=${encodeURIComponent(event.id)}`} />
      </div>
    </section>
  );
}
