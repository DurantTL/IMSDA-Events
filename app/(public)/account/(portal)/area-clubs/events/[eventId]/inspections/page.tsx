import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { CoordinatorUnavailable } from "@/components/coordinator-overview";
import { InspectionEntry } from "@/components/inspection-entry";
import { logError } from "@/lib/logger";
import { loadInspectionView } from "@/modules/event-inspections/service";
import { EventScoringError } from "@/modules/event-scoring/service";
import { currentAreaCoordinator, currentAreaCoordinatorViewerActive } from "@/modules/organizations/area-coordinators";

export const metadata: Metadata = { title: "Inspections", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * Inspections for one club event (#1896): the optional tool an Area Coordinator switches on, then uses on a phone to enter
 * campsite and uniform scores or import them from a CSV. Staff acting as a coordinator (#442) read a note only.
 */
export default async function AreaInspectionsPage({ params }: { params: Promise<{ eventId: string }> }) {
  // Layouts do not re-run on navigation, so every page checks for itself (#657).
  if (!(await currentAreaCoordinatorViewerActive())) notFound();
  const { eventId } = await params;
  const account = await currentAreaCoordinator();
  const loaded = account
    ? await loadInspectionView(eventId, { kind: "area-coordinator", accountId: account.id }).catch((error: unknown) => {
      if (error instanceof EventScoringError && error.code === "EVENT_NOT_FOUND") return "missing" as const;
      logError("Coordinator inspections read failed", error, { eventId });
      return null;
    })
    : "view-only" as const;
  if (loaded === "missing") notFound();
  return (
    <section className="public-manage-card page-stack coordinator-destination">
      <BackLink href="/account/area-clubs/events">Back to club events</BackLink>
      {loaded === null ? (
        <CoordinatorUnavailable what="Inspections" />
      ) : loaded === "view-only" ? (
        <>
          <div className="public-manage-card-heading">
            <p className="public-registration-eyebrow">Club coordination</p>
            <h2>Inspections</h2>
          </div>
          <p className="field-help">Only an Area Coordinator signed in with their own account can use this tool.</p>
        </>
      ) : (
        <>
          <div className="public-manage-card-heading">
            <p className="public-registration-eyebrow">Club coordination</p>
            <h2>Inspections<br /><span translate="no">{loaded.eventName}</span></h2>
          </div>
          <p className="field-help">
            An optional tool for campsite and uniform inspections. Scores go into Camporee scoring, which you turn on first. Turning Inspections off hides this screen and keeps every score.
          </p>
          <InspectionEntry endpoint={`/api/attendee/area-clubs/events/${encodeURIComponent(eventId)}/inspections`} initial={loaded} scoringHref={`/account/area-clubs/events/${encodeURIComponent(eventId)}/scoring`} />
        </>
      )}
    </section>
  );
}
