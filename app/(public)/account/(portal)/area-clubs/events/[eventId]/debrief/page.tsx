import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { CoordinatorUnavailable } from "@/components/coordinator-overview";
import { DebriefPanel } from "@/components/debrief-panel";
import { logError } from "@/lib/logger";
import { DebriefError, loadDebriefToolState } from "@/modules/event-debriefs/settings";
import { currentAreaCoordinator, currentAreaCoordinatorViewerActive } from "@/modules/organizations/area-coordinators";

export const metadata: Metadata = { title: "Event debrief", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * The Event debrief for one club event (#1679): the optional tool an Area Coordinator switches on, after which they and the
 * event's staff are emailed a short debrief the morning after the event. Their one write; they do not read the answers here
 * (event staff and system administrators do). Staff acting as a coordinator (#442) read the page only.
 */
export default async function AreaDebriefPage({ params }: { params: Promise<{ eventId: string }> }) {
  // Layouts do not re-run on navigation, so every page checks for itself (#657).
  if (!(await currentAreaCoordinatorViewerActive())) notFound();
  const { eventId } = await params;
  const account = await currentAreaCoordinator();
  const loaded = account
    ? await loadDebriefToolState(eventId, "area-coordinator").catch((error: unknown) => {
      if (error instanceof DebriefError && error.code === "EVENT_NOT_FOUND") return "missing" as const;
      logError("Coordinator debrief read failed", error, { eventId });
      return null;
    })
    : "view-only" as const;
  if (loaded === "missing") notFound();
  return (
    <section className="public-manage-card page-stack coordinator-destination">
      <BackLink href="/account/area-clubs/events">Back to club events</BackLink>
      {loaded === null ? (
        <CoordinatorUnavailable what="Event debrief" />
      ) : loaded === "view-only" ? (
        <>
          <div className="public-manage-card-heading">
            <p className="public-registration-eyebrow">Club coordination</p>
            <h2>Event debrief</h2>
          </div>
          <p className="field-help">Only an Area Coordinator signed in with their own account can use this tool.</p>
        </>
      ) : (
        <>
          <div className="public-manage-card-heading">
            <p className="public-registration-eyebrow">Club coordination</p>
            <h2>Event debrief<br /><span translate="no">{loaded.eventName}</span></h2>
          </div>
          <p className="field-help">
            An optional tool. Turn it on to be emailed three short questions the morning after this event ends, with one reminder three days later, along with the event&apos;s staff and the other Area Coordinators.
            Event staff and system administrators read the answers. Turning it off stops emails not yet sent and keeps the questions and answers.
          </p>
          <DebriefPanel canChooseEvaluation={false} endpoint={`/api/attendee/area-clubs/events/${encodeURIComponent(eventId)}/debrief`} initial={{ enabled: loaded.enabled, evaluationEnabled: loaded.evaluationEnabled, fillPath: loaded.fillPath }} />
        </>
      )}
    </section>
  );
}
