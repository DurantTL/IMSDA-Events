import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { ClubTeachersPanel } from "@/components/club-teachers-panel";
import { ClubTeachersSummary } from "@/components/club-teachers-summary";
import { CoordinatorUnavailable } from "@/components/coordinator-overview";
import { logError } from "@/lib/logger";
import { ClubTeacherError } from "@/modules/club-teachers/repository";
import { loadTeacherToolState } from "@/modules/club-teachers/settings";
import { loadTeacherSummary } from "@/modules/club-teachers/summary";
import { currentAreaCoordinator, currentAreaCoordinatorViewerActive } from "@/modules/organizations/area-coordinators";

export const metadata: Metadata = { title: "Club teachers", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * Club teachers for one club event (#1681): the optional tool an Area Coordinator switches on for themselves, and the
 * count of teachers per weekend or site and per club. The switch is the coordinator's one write; the rest is view only.
 */
export default async function AreaClubTeachersPage({ params }: { params: Promise<{ eventId: string }> }) {
  // Layouts do not re-run on navigation, so every page checks for itself (#657).
  if (!(await currentAreaCoordinatorViewerActive())) notFound();
  const { eventId } = await params;
  // Only a real coordinator account can switch it; staff acting as one (#442) read the page only.
  const canChange = Boolean(await currentAreaCoordinator());
  const loaded = await Promise.all([loadTeacherToolState(eventId, "area-coordinator"), loadTeacherSummary(eventId)]).catch((error: unknown) => {
    if (error instanceof ClubTeacherError && error.code === "EVENT_NOT_FOUND") return "missing" as const;
    logError("Coordinator club teachers read failed", error, { eventId });
    return null;
  });
  if (loaded === "missing") notFound();
  return (
    <section className="public-manage-card page-stack coordinator-destination">
      <BackLink href="/account/area-clubs/events">Back to club events</BackLink>
      {loaded === null ? (
        <CoordinatorUnavailable what="Club teachers" />
      ) : (
        <>
          <div className="public-manage-card-heading">
            <p className="public-registration-eyebrow">Club coordination</p>
            <h2>Club teachers<br /><span translate="no">{loaded[0].eventName}</span></h2>
          </div>
          <p className="field-help">
            An optional tool. Turn it on to ask each club who from the club is teaching. It changes nothing for clubs until you save a rule.
            Turning it off hides it again and keeps what clubs already entered.
          </p>
          {canChange
            ? <ClubTeachersPanel canRequire={false} endpoint={`/api/attendee/area-clubs/events/${encodeURIComponent(eventId)}/club-teachers`} initial={{ enabled: loaded[0].enabled, rule: loaded[0].rule }} />
            : <p className="field-help">Only an Area Coordinator signed in with their own account can switch this tool.</p>}
          <ClubTeachersSummary summary={loaded[1]} />
        </>
      )}
    </section>
  );
}
