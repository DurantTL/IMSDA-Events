import type { Metadata } from "next";
import Link from "next/link";
import { AccessRestricted } from "@/components/access-restricted";
import { EventScoringWorkspace } from "@/components/event-scoring-workspace";
import { NotAvailableForEvent } from "@/components/not-available-for-event";
import { staffPageTitles } from "@/components/staff-navigation";
import { logError } from "@/lib/logger";
import { EventScoringError, loadEventScoringView, type EventScoringActor } from "@/modules/event-scoring/service";
import { resolveClubOversight } from "@/modules/club-rosters/event-oversight";

export const metadata: Metadata = { title: staffPageTitles.eventScoring };
export const dynamic = "force-dynamic";

/**
 * Staff screen for the optional Camporee scoring tool (#1676): the switch, the scored events, score entry, publishing and
 * the results. Administrators (a system administrator, an Event Admin or the Clubs Administrator, the people
 * `resolveClubOversight` admits) use all of it; staff with the registration permission enter scores only. It also works
 * on a club event that is not published yet.
 */
export default async function EventScoringPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const requested = (await searchParams).event;
  const { event, allowed, clubEvent, permissions, user } = await resolveClubOversight(requested);
  if (!clubEvent) {
    return <NotAvailableForEvent reason="This event doesn't take club registrations. Choose a club event to score a camporee." />;
  }
  if (!allowed && !permissions.includes("MANAGE_REGISTRATION")) {
    return <AccessRestricted title="Camporee scoring is restricted" detail="Camporee scoring is for event administrators, the Clubs Administrator and staff who manage registrations." whoToAsk="your event administrator" />;
  }
  const actor: EventScoringActor = { kind: "staff", userId: user.id, administrator: allowed };
  let state: Awaited<ReturnType<typeof loadEventScoringView>>;
  try {
    state = await loadEventScoringView(event.id, actor);
  } catch (error) {
    if (!(error instanceof EventScoringError)) logError("Camporee scoring page read failed", error, { eventId: event.id });
    return (
      <section className="page-stack">
        <div className="panel page-stack">
          <h2>Camporee scoring</h2>
          <p>{error instanceof EventScoringError ? "This event is archived, so Camporee scoring can't be changed." : "Camporee scoring couldn't be loaded right now."}</p>
          <p className="field-help">Pick another club event from the event menu, or <Link href="/more">go back to More</Link> and try again.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="page-stack">
      <div className="panel page-stack">
        <h2>Camporee scoring<br /><span translate="no">{event.name}</span></h2>
        <p className="field-help">
          An optional tool. Turn it on to enter scores for each camporee event, rank clubs and Pathfinders, and list ribbons for the clubs that asked for them.
          Area Coordinators can turn it on and enter scores too; only the Clubs Administrator or event staff publish. Turning it off hides it and keeps what was entered.
        </p>
        <EventScoringWorkspace endpoint={`/api/events/${encodeURIComponent(event.id)}/event-scoring`} initial={state} />
      </div>
    </section>
  );
}
