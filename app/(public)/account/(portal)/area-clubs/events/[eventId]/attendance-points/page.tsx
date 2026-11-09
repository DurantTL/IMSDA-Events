import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { AttendancePointsWorkspace } from "@/components/attendance-points-workspace";
import { CoordinatorUnavailable } from "@/components/coordinator-overview";
import { logError } from "@/lib/logger";
import { AttendancePointsError, loadAttendancePointsView } from "@/modules/event-points/service";
import { currentAreaCoordinator, currentAreaCoordinatorViewerActive } from "@/modules/organizations/area-coordinators";

export const metadata: Metadata = { title: "Attendance points", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * Attendance points for one club event (#1677): the optional tool an Area Coordinator switches on for themselves, then uses
 * to set the points and read the review by club (counts and reasons, no names). The coordinator's one write; marking,
 * overrides and applying stay with staff. Staff acting as a coordinator (#442) read the page only.
 */
export default async function AreaAttendancePointsPage({ params }: { params: Promise<{ eventId: string }> }) {
  // Layouts do not re-run on navigation, so every page checks for itself (#657).
  if (!(await currentAreaCoordinatorViewerActive())) notFound();
  const { eventId } = await params;
  const account = await currentAreaCoordinator();
  const actor = account ? { kind: "area-coordinator" as const, accountId: account.id } : null;
  const loaded = actor
    ? await loadAttendancePointsView(eventId, actor).catch((error: unknown) => {
      if (error instanceof AttendancePointsError && error.code === "EVENT_NOT_FOUND") return "missing" as const;
      logError("Coordinator attendance points read failed", error, { eventId });
      return null;
    })
    : "view-only" as const;
  if (loaded === "missing") notFound();
  return (
    <section className="public-manage-card page-stack coordinator-destination">
      <BackLink href="/account/area-clubs/events">Back to club events</BackLink>
      {loaded === null ? (
        <CoordinatorUnavailable what="Attendance points" />
      ) : loaded === "view-only" ? (
        <>
          <div className="public-manage-card-heading">
            <p className="public-registration-eyebrow">Club coordination</p>
            <h2>Attendance points</h2>
          </div>
          <p className="field-help">Only an Area Coordinator signed in with their own account can use this tool.</p>
        </>
      ) : (
        <>
          <div className="public-manage-card-heading">
            <p className="public-registration-eyebrow">Club coordination</p>
            <h2>Attendance points<br /><span translate="no">{loaded.eventName}</span></h2>
          </div>
          <p className="field-help">
            An optional tool. Turn it on to give clubs points for attending this event, using the rules the Area Coordinators voted on. You see counts and reasons for each club, not names.
            It changes nothing for clubs until the Clubs Administrator or event staff apply the points. Turning it off hides it again and keeps what you set up.
          </p>
          <AttendancePointsWorkspace endpoint={`/api/attendee/area-clubs/events/${encodeURIComponent(eventId)}/attendance-points`} initial={loaded} />
        </>
      )}
    </section>
  );
}
