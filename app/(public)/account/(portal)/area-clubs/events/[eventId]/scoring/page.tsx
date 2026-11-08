import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { EventScoringWorkspace } from "@/components/event-scoring-workspace";
import { CoordinatorUnavailable } from "@/components/coordinator-overview";
import { logError } from "@/lib/logger";
import { EventScoringError, loadEventScoringView } from "@/modules/event-scoring/service";
import { currentAreaCoordinator, currentAreaCoordinatorViewerActive } from "@/modules/organizations/area-coordinators";

export const metadata: Metadata = { title: "Camporee scoring", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * Camporee scoring for one club event (#1676): the optional tool an Area Coordinator switches on for themselves, then uses
 * to set up scored events and enter scores. The coordinator's one write; publishing stays with staff. Staff acting as a
 * coordinator (#442) read the page only.
 */
export default async function AreaEventScoringPage({ params }: { params: Promise<{ eventId: string }> }) {
  // Layouts do not re-run on navigation, so every page checks for itself (#657).
  if (!(await currentAreaCoordinatorViewerActive())) notFound();
  const { eventId } = await params;
  const account = await currentAreaCoordinator();
  const actor = account ? { kind: "area-coordinator" as const, accountId: account.id } : null;
  const loaded = actor
    ? await loadEventScoringView(eventId, actor).catch((error: unknown) => {
      if (error instanceof EventScoringError && error.code === "EVENT_NOT_FOUND") return "missing" as const;
      logError("Coordinator camporee scoring read failed", error, { eventId });
      return null;
    })
    : "view-only" as const;
  if (loaded === "missing") notFound();
  return (
    <section className="public-manage-card page-stack coordinator-destination">
      <BackLink href="/account/area-clubs/events">Back to club events</BackLink>
      {loaded === null ? (
        <CoordinatorUnavailable what="Camporee scoring" />
      ) : loaded === "view-only" ? (
        <>
          <div className="public-manage-card-heading">
            <p className="public-registration-eyebrow">Club coordination</p>
            <h2>Camporee scoring</h2>
          </div>
          <p className="field-help">Only an Area Coordinator signed in with their own account can use this tool.</p>
        </>
      ) : (
        <>
          <div className="public-manage-card-heading">
            <p className="public-registration-eyebrow">Club coordination</p>
            <h2>Camporee scoring<br /><span translate="no">{loaded.eventName}</span></h2>
          </div>
          <p className="field-help">
            An optional tool. Turn it on to enter scores for each camporee event and see rankings and ribbons. It changes nothing for clubs until results are published,
            and only the Clubs Administrator or event staff publish. Turning it off hides it again and keeps what you entered.
          </p>
          <EventScoringWorkspace endpoint={`/api/attendee/area-clubs/events/${encodeURIComponent(eventId)}/event-scoring`} initial={loaded} />
        </>
      )}
    </section>
  );
}
