import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { ClubReportColumnBuilder } from "@/components/club-report-column-builder";
import { CoordinatorUnavailable } from "@/components/coordinator-overview";
import { logError } from "@/lib/logger";
import { currentAreaCoordinatorViewerActive } from "@/modules/organizations/area-coordinators";
import { CLUB_REPORT_COLUMNS, DEFAULT_CLUB_REPORT_COLUMNS, clubReportColumnKeysFor, type ClubReportViewer } from "@/modules/reporting/club-report-columns";
import { ClubReportError, listClubReportLayouts, requireCoordinatorClubEvent } from "@/modules/reporting/club-report-export";

export const metadata: Metadata = { title: "Attendee report", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

const viewer: ClubReportViewer = { kind: "coordinator" };

/**
 * An Area Coordinator's attendee report for one club event (#1671): choose columns, preview, print or download. Same
 * access as the other coordinator event pages (an active grant with the second sign-in step passed, or staff acting
 * as one). The columns are only those the coordinator view already shows.
 */
export default async function AreaClubEventReportPage({ params }: { params: Promise<{ eventId: string }> }) {
  // Layouts do not re-run on navigation, so every page checks for itself (#657).
  if (!(await currentAreaCoordinatorViewerActive())) notFound();
  const { eventId } = await params;
  const loaded = await Promise.all([requireCoordinatorClubEvent(eventId), listClubReportLayouts(eventId, viewer)]).catch((error: unknown) => {
    if (error instanceof ClubReportError && error.code === "EVENT_NOT_FOUND") return "missing" as const;
    logError("Coordinator attendee report read failed", error, { eventId });
    return null;
  });
  if (loaded === "missing") notFound();
  return (
    <section className="public-manage-card page-stack coordinator-destination">
      <BackLink href="/account/area-clubs/events">Back to club events</BackLink>
      {loaded === null ? (
        <CoordinatorUnavailable what="The attendee report" />
      ) : (
        <>
          <div className="public-manage-card-heading">
            <p className="public-registration-eyebrow">Club coordination</p>
            <h2>Attendee report<br /><span translate="no">{loaded[0].name}</span></h2>
          </div>
          <p className="field-help">
            Who is registered, one row per person. You can include names, age, role, class and the event answers (ribbons,
            baptism interest, medical volunteer, Master Guide, first-time camper). Birth dates, dietary needs, medical
            information and parent or guardian contacts are never included. Every print and download is logged.
          </p>
          <ClubReportColumnBuilder
            defaultKeys={[...DEFAULT_CLUB_REPORT_COLUMNS]}
            endpoint={`/api/attendee/area-clubs/events/${encodeURIComponent(eventId)}/report-columns`}
            initialLayouts={loaded[1]}
            options={clubReportColumnKeysFor(viewer).map((key) => ({ key, header: CLUB_REPORT_COLUMNS[key].header }))}
          />
        </>
      )}
    </section>
  );
}
