import type { Metadata } from "next";
import Link from "next/link";
import { AccessRestricted } from "@/components/access-restricted";
import { DebriefPanel } from "@/components/debrief-panel";
import { DebriefResultsView } from "@/components/debrief-results";
import { NotAvailableForEvent } from "@/components/not-available-for-event";
import { staffPageTitles } from "@/components/staff-navigation";
import { logError } from "@/lib/logger";
import { getCurrentSession } from "@/modules/access/current-session";
import { getPrisma } from "@/lib/prisma";
import { DebriefError, loadDebriefToolState } from "@/modules/event-debriefs/settings";
import { canReadDebriefAnswers, loadCarriedDebriefResults, loadDebriefResults } from "@/modules/event-debriefs/results";
import { resolveEventContext } from "@/modules/events/selection";

export const metadata: Metadata = { title: staffPageTitles.eventDebrief };
export const dynamic = "force-dynamic";

/**
 * Staff screen for the optional Event debrief (#1679): the switch, the director evaluation's switch, a link to edit the
 * questions, and the answers. Switching is for a system administrator, an Event Admin or the Clubs Administrator; reading the
 * answers is for event staff holding MANAGE_FORMS and system administrators, checked on the server, here and again for last
 * year's event when its answers are shown.
 */
export default async function EventDebriefPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const requested = (await searchParams).event;
  const { event, user, membership, permissions } = await resolveEventContext(requested);
  const canSwitch = user.globalRole === "SYSTEM_ADMIN" || membership?.role === "EVENT_ADMIN";
  const session = await getCurrentSession();
  const canRead = await canReadDebriefAnswers(session, event.id);
  if (!canSwitch && !canRead) {
    return <AccessRestricted title="The event debrief is restricted" detail="Event administrators and the Clubs Administrator can turn the debrief on, and event administrators and registration managers can read its answers." whoToAsk="your event administrator" />;
  }
  let state: Awaited<ReturnType<typeof loadDebriefToolState>>;
  try {
    state = await loadDebriefToolState(event.id, "staff");
  } catch (error) {
    if (error instanceof DebriefError && error.code === "EVENT_NOT_FOUND") {
      return <NotAvailableForEvent reason="The event debrief is for club events. Choose a club event, or this one may be archived." />;
    }
    logError("Event debrief page read failed", error, { eventId: event.id });
    return (
      <section className="page-stack">
        <div className="panel page-stack">
          <h2>Event debrief</h2>
          <p>The event debrief couldn&apos;t be loaded right now.</p>
          <p className="field-help">Pick another event from the event menu, or <Link href="/more">go back to More</Link> and try again.</p>
        </div>
      </section>
    );
  }
  const [results, carried, form] = await Promise.all([
    canRead ? loadDebriefResults(event.id) : Promise.resolve(null),
    loadCarriedDebriefResults(session, event.id),
    getPrisma().informationForm.findFirst({ where: { eventId: event.id, purpose: "DEBRIEF" }, select: { id: true } }),
  ]);
  const editHref = form && permissions.includes("MANAGE_FORMS") ? `/information-forms?event=${encodeURIComponent(event.id)}&form=${encodeURIComponent(form.id)}` : null;
  return (
    <section className="page-stack">
      <div className="panel page-stack">
        <h2>Event debrief<br /><span translate="no">{event.name}</span></h2>
        <p className="field-help">
          An optional tool. Turn it on to ask the event&apos;s staff and the Area Coordinators three short questions the morning after the event ends, with one reminder three days later.
          The answers stay with the event, are read by event staff and system administrators only, and are shown when the event is copied for next year. Turning it off stops emails not yet sent and keeps the questions and answers.
        </p>
        {canSwitch ? (
          <DebriefPanel canChooseEvaluation endpoint={`/api/events/${encodeURIComponent(event.id)}/debrief`} initial={{ enabled: state.enabled, evaluationEnabled: state.evaluationEnabled, fillPath: state.fillPath }} />
        ) : (
          <p className="field-help">The debrief is {state.enabled ? "on" : "off"}. Event administrators and the Clubs Administrator turn it on or off.</p>
        )}
        {editHref && <p><Link className="secondary-button" href={editHref}>Edit the questions</Link></p>}
      </div>
      {results && (
        <div className="panel page-stack">
          <h2>Answers</h2>
          <DebriefResultsView idPrefix="answers" results={results} />
        </div>
      )}
      {carried && (
        <div className="panel page-stack">
          <h2>Last year&apos;s debrief</h2>
          <DebriefResultsView idPrefix="carried" readOnlyFrom={{ href: `/more/debrief?event=${encodeURIComponent(carried.sourceEventId)}` }} results={carried.results} />
        </div>
      )}
    </section>
  );
}
