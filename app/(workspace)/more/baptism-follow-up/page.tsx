import type { Metadata } from "next";
import Link from "next/link";
import { AccessRestricted } from "@/components/access-restricted";
import { BaptismFollowUpList } from "@/components/baptism-follow-up-list";
import { BaptismFollowUpPanel } from "@/components/baptism-follow-up-panel";
import { NotAvailableForEvent } from "@/components/not-available-for-event";
import { staffPageTitles } from "@/components/staff-navigation";
import { logError } from "@/lib/logger";
import { loadBaptismFollowUpPage } from "@/modules/baptism-follow-up/settings";
import { resolveClubOversight } from "@/modules/club-rosters/event-oversight";

export const metadata: Metadata = { title: staffPageTitles.baptismFollowUp };
export const dynamic = "force-dynamic";

/**
 * Staff screen for the optional Baptism follow-up (#1680): the event lead addresses and the names passed on. Only people
 * `resolveClubOversight` admits (system administrators, Event Admins, the Clubs Administrator), checked on the server, and the
 * save route checks again. A system administrator turns the module on from the event features page.
 */
export default async function BaptismFollowUpPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const requested = (await searchParams).event;
  const { event, allowed, clubEvent } = await resolveClubOversight(requested);
  if (!clubEvent) {
    return <NotAvailableForEvent reason="This event doesn't take club registrations. Choose a club event to set up baptism follow-up." />;
  }
  if (!allowed) {
    return <AccessRestricted title="Baptism follow-up is restricted" detail="Baptism follow-up is for event administrators and the Clubs Administrator." whoToAsk="your event administrator" />;
  }
  let state: Awaited<ReturnType<typeof loadBaptismFollowUpPage>>;
  try {
    state = await loadBaptismFollowUpPage(event.id);
  } catch (error) {
    logError("Baptism follow-up page read failed", error, { eventId: event.id });
    return (
      <section className="page-stack">
        <div className="panel page-stack">
          <h2>Baptism follow-up</h2>
          <p>Baptism follow-up couldn&apos;t be loaded right now.</p>
          <p className="field-help">Pick another club event from the event menu, or <Link href="/more">go back to More</Link> and try again.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="page-stack">
      <div className="panel page-stack">
        <h2>Baptism follow-up<br /><span translate="no">{event.name}</span></h2>
        <p className="field-help">
          An optional tool. When a club names someone for baptism on its registration, the event lead and the club&apos;s church pastor each get one short email with the name, the club,
          the event and its dates, asking them to follow up. Each name is sent once, and nothing else about the person is included.
          It starts off for every event; a system administrator turns it on from the event features page.
        </p>
        {state.enabled ? (
          <>
            <p className="field-help" role="status">Baptism follow-up is on for this event.</p>
            <BaptismFollowUpPanel endpoint={`/api/events/${encodeURIComponent(event.id)}/baptism-follow-up`} initialEmails={state.leadEmails} />
            {state.leadEmails.length === 0 && <p className="field-help">No event lead is set, so no notices are sent. Add an address above.</p>}
          </>
        ) : (
          <p className="field-help" role="status">Baptism follow-up is off for this event, so no notices are sent. A system administrator can turn it on from the event features page.</p>
        )}
      </div>
      {state.enabled && (
        <div className="panel page-stack">
          <h2>Names passed on</h2>
          <BaptismFollowUpList clubs={state.clubs} />
        </div>
      )}
    </section>
  );
}
